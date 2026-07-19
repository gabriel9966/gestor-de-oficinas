import cors from 'cors'
import express from 'express'
import { randomBytes } from 'node:crypto'
import { one, many, run } from './db.js'
import { nextOrderNumber, nextInvoiceNumber, recalculateOrderTotal, recalculatePaymentStatus, ensureDefaultPipeline } from './database.js'
import { sendExternalMessage } from './messaging.js'
import { t, notFound } from './i18n.js'
import { hashPassword, verifyPassword, signToken, authenticate, requireTenant, requireSuperAdmin } from './auth.js'
import { loginLimiter } from './security.js'
import { logAudit } from './audit.js'
import { createCheckoutSession, handleWebhookEvent } from './billing.js'
const app = express(), port = Number(process.env.PORT || 3001)
const allowedOrigins = process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(',') : true
app.use(cors({ origin: allowedOrigins })); app.use(express.json({ limit: '15mb' }))
const orderSelect = `SELECT so.*,c.name client_name,c.phone client_phone,v.plate,v.brand,v.model,v.version,v.mileage vehicle_mileage,e.name mechanic_name FROM service_orders so JOIN clients c ON c.id=so.client_id JOIN vehicles v ON v.id=so.vehicle_id LEFT JOIN employees e ON e.id=so.mechanic_id`
const plate = v => String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const slugify = s => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
const stagesOf = pipeline => JSON.parse(pipeline.stages)
const getPipeline = (tenantId, id) => id ? one('SELECT * FROM pipelines WHERE id=? AND tenant_id=?', [id, tenantId]) : one('SELECT * FROM pipelines WHERE tenant_id=? ORDER BY id LIMIT 1', [tenantId])
const missing = (req, res, key) => res.status(404).json({error:notFound(req,key)})
async function verifyTenantSubscription(req,res,next) {
  const tenant = await one('SELECT * FROM tenants WHERE id=?', [req.tenantId])
  req.tenant = tenant
  if (req.user.role === 'super_admin') return next()
  if (!tenant || !tenant.active || ['past_due','canceled'].includes(tenant.status)) return res.status(403).json({error:t(req,'subscriptionBlocked')})
  next()
}
const requirePlan = (...plans) => (req,res,next) => plans.includes(req.tenant?.plan) ? next() : res.status(403).json({error:t(req,'planUpgradeRequired')})
const requireOwner = (req,res,next) => req.user.role === 'owner' ? next() : res.status(403).json({error:t(req,'ownerRequired')})
const reminderTypeLabels = { troca_oleo:'troca de óleo', revisao:'revisão geral', alinhamento:'alinhamento e balanceamento', filtro_ar:'troca de filtro de ar', pneus:'troca de pneus', bateria:'troca de bateria', freios:'revisão de freios', suspensao:'revisão de suspensão', outro:'uma manutenção' }
const oilMessage = ({ client, vehicle, dueMileage, dueDate, type='troca_oleo' }) => `Olá, ${client}! O ${vehicle.brand} ${vehicle.model} (${vehicle.plate}) está próximo de ${reminderTypeLabels[type] || reminderTypeLabels.outro}${dueMileage ? ` aos ${Number(dueMileage).toLocaleString('pt-BR')} km` : ''}${dueDate ? ` ou em ${new Date(dueDate).toLocaleDateString('pt-BR')}` : ''}. Quer agendar seu atendimento?`
async function ensureVehicleToken(vehicle) {
  if (vehicle.public_token) return vehicle.public_token
  const token = randomBytes(16).toString('hex')
  await run('UPDATE vehicles SET public_token=? WHERE id=?', [token, vehicle.id])
  return token
}
async function ensureOrderApprovalToken(order) {
  if (order.approval_token) return order.approval_token
  const token = randomBytes(16).toString('hex')
  await run('UPDATE service_orders SET approval_token=? WHERE id=?', [token, order.id])
  return token
}
function dueReminders(tenantId) { return many(`SELECT r.*,c.name client_name,c.phone,v.plate,v.brand,v.model,v.mileage FROM reminders r JOIN clients c ON c.id=r.client_id JOIN vehicles v ON v.id=r.vehicle_id WHERE r.tenant_id=? AND r.status='agendado' AND ((r.due_date IS NOT NULL AND r.due_date::date <= CURRENT_DATE) OR (r.due_mileage IS NOT NULL AND v.mileage >= r.due_mileage)) ORDER BY r.due_date`, [tenantId]) }
async function runAutomations(tenantId, module, field, value, entityId) {
  const rules = await many('SELECT * FROM automation_rules WHERE tenant_id=? AND active=1 AND module=? AND field=? AND value=?', [tenantId, module, field, value])
  if (!rules.length) return
  const context = module === 'service_orders' ? await one(`${orderSelect} WHERE so.id=?`, [entityId]) : await one('SELECT * FROM leads WHERE id=?', [entityId])
  if (!context) return
  const recipient = module === 'service_orders' ? context.client_phone : context.phone
  if (!recipient) return
  const placeholders = { '{cliente}': context.client_name || context.name || '', '{nome}': context.name || context.client_name || '', '{placa}': context.plate || '', '{veiculo}': [context.brand, context.model].filter(Boolean).join(' '), '{os}': context.number || '', '{etapa}': value, '{status}': value }
  for (const rule of rules) {
    const already = await one('SELECT id FROM automation_runs WHERE rule_id=? AND entity_id=?', [rule.id, entityId])
    if (already) continue
    const content = Object.entries(placeholders).reduce((text, [key, val]) => text.replaceAll(key, val), rule.message_template)
    const leadId = module === 'leads' ? context.id : null, clientId = module === 'service_orders' ? context.client_id : null
    const r = await run("INSERT INTO crm_messages (tenant_id,lead_id,client_id,channel,direction,recipient,content,status) VALUES (?,?,?,?,'saida',?,?,'fila') RETURNING id", [tenantId, leadId, clientId, rule.channel, recipient, content])
    await run('INSERT INTO automation_runs (tenant_id,rule_id,entity_id) VALUES (?,?,?) RETURNING id', [tenantId, rule.id, entityId])
    sendExternalMessage({ channel: rule.channel, recipient, content }).then(async result => {
      await run("UPDATE crm_messages SET status='enviado',provider_message_id=?,sent_at=now_text() WHERE id=?", [result.id, r.lastInsertRowid])
    }).catch(async error => {
      await run("UPDATE crm_messages SET status='erro',error=? WHERE id=?", [error.message, r.lastInsertRowid])
    })
  }
}
function flowContext(module, entityId) { return module === 'service_orders' ? one(`${orderSelect} WHERE so.id=?`, [entityId]) : one('SELECT * FROM leads WHERE id=?', [entityId]) }
function resolveTemplate(template, context) {
  const placeholders = { '{cliente}': context.client_name || context.name || '', '{placa}': context.plate || '', '{veiculo}': [context.brand, context.model].filter(Boolean).join(' '), '{os}': context.number || '', '{valor}': context.total_amount != null ? `R$ ${Number(context.total_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '' }
  return Object.entries(placeholders).reduce((text, [key, val]) => text.replaceAll(key, val), template || '')
}
async function sendFlowMessage(tenantId, module, context, step) {
  const recipient = module === 'service_orders' ? context.client_phone : context.phone
  if (!recipient) return
  const content = resolveTemplate(step.template, context)
  const leadId = module === 'leads' ? context.id : null, clientId = module === 'service_orders' ? context.client_id : null
  const r = await run("INSERT INTO crm_messages (tenant_id,lead_id,client_id,channel,direction,recipient,content,status) VALUES (?,?,?,?,'saida',?,?,'fila') RETURNING id", [tenantId, leadId, clientId, step.channel || 'whatsapp', recipient, content])
  sendExternalMessage({ channel: step.channel || 'whatsapp', recipient, content }).then(async result => {
    await run("UPDATE crm_messages SET status='enviado',provider_message_id=?,sent_at=now_text() WHERE id=?", [result.id, r.lastInsertRowid])
  }).catch(async error => {
    await run("UPDATE crm_messages SET status='erro',error=? WHERE id=?", [error.message, r.lastInsertRowid])
  })
}
async function runFlowAction(tenantId, module, context, action) {
  if (!action) return
  if (action.type === 'message') await sendFlowMessage(tenantId, module, context, action)
  else if (action.type === 'move_stage' && module === 'leads') await run("UPDATE leads SET stage=?,updated_at=now_text() WHERE id=?", [action.value, context.id])
  else if (action.type === 'alert') {
    if (module === 'service_orders') await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description) VALUES (?,?,?,?,?) RETURNING id', [tenantId, context.vehicle_id, context.id, 'alerta', action.message || 'Alerta interno do fluxo de automação.'])
    else await run("INSERT INTO crm_activities (tenant_id,lead_id,type,description) VALUES (?,?,'alerta',?) RETURNING id", [tenantId, context.id, action.message || 'Alerta interno do fluxo de automação.'])
  }
}
async function processFlowRuns() {
  const runs = await many("SELECT * FROM flow_runs WHERE status='ativo' AND (resume_at IS NULL OR resume_at<=to_char(timezone('UTC',now()),'YYYY-MM-DD HH24:MI:SS'))")
  for (const flowRun of runs) {
    const flow = await one('SELECT * FROM automation_flows WHERE id=?', [flowRun.flow_id])
    if (!flow || !flow.active) { await run("UPDATE flow_runs SET status='cancelado',updated_at=now_text() WHERE id=?", [flowRun.id]); continue }
    const steps = JSON.parse(flow.steps)
    const step = steps[flowRun.step_index]
    const context = await flowContext(flow.module, flowRun.entity_id)
    if (!step || !context) { await run("UPDATE flow_runs SET status='concluido',updated_at=now_text() WHERE id=?", [flowRun.id]); continue }
    if (step.type === 'message') { await sendFlowMessage(flow.tenant_id, flow.module, context, step); await run("UPDATE flow_runs SET step_index=step_index+1,resume_at=NULL,updated_at=now_text() WHERE id=?", [flowRun.id]) }
    else if (step.type === 'delay') { await run(`UPDATE flow_runs SET step_index=step_index+1,resume_at=to_char(timezone('UTC',now()) + (? || ' ' || ?)::interval,'YYYY-MM-DD HH24:MI:SS'),updated_at=now_text() WHERE id=?`, [step.amount, step.unit, flowRun.id]) }
    else if (step.type === 'condition') {
      const currentValue = flow.trigger_field === 'status' ? context.status : context.stage
      await runFlowAction(flow.tenant_id, flow.module, context, currentValue === step.value ? step.thenAction : step.elseAction)
      await run("UPDATE flow_runs SET status='concluido',updated_at=now_text() WHERE id=?", [flowRun.id])
    } else await run("UPDATE flow_runs SET status='concluido',updated_at=now_text() WHERE id=?", [flowRun.id])
  }
}
async function startFlows(tenantId, module, field, value, entityId) {
  const flows = await many('SELECT * FROM automation_flows WHERE tenant_id=? AND active=1 AND module=? AND trigger_field=? AND trigger_value=?', [tenantId, module, field, value])
  for (const flow of flows) await run('INSERT INTO flow_runs (tenant_id,flow_id,entity_id) VALUES (?,?,?) ON CONFLICT (flow_id,entity_id) DO NOTHING', [tenantId, flow.id, entityId])
  if (flows.length) await processFlowRuns()
}
setInterval(() => { processFlowRuns().catch(err => console.error('processFlowRuns:', err)) }, 15000)

app.get('/api/health',(_,res)=>res.json({status:'ok',service:'oficina-pro-api',timestamp:new Date().toISOString()}))
app.post('/api/auth/login', loginLimiter, async (req,res)=>{
  const {email,password}=req.body
  if(!email?.trim()||!password)return res.status(400).json({error:t(req,'emailPasswordRequired')})
  const user=await one('SELECT * FROM users WHERE email=? AND active=1', [email.trim().toLowerCase()])
  if(!user||!verifyPassword(password,user.password_hash))return res.status(401).json({error:t(req,'invalidCredentials')})
  if(user.totp_enabled){
    const {totp_code}=req.body
    if(!totp_code)return res.status(401).json({error:t(req,'totpRequired'),totp_required:true})
    const {verifyTotp}=await import('./auth.js')
    if(!verifyTotp(user.totp_secret,totp_code))return res.status(401).json({error:t(req,'invalidTotp')})
  }
  const tenant=user.tenant_id?await one('SELECT * FROM tenants WHERE id=?', [user.tenant_id]):null
  const token=signToken({sub:user.id,name:user.name,email:user.email,role:user.role,tenant_id:user.tenant_id})
  await logAudit({tenantId:user.tenant_id,userId:user.id,action:'login',entity:'user',entityId:user.id})
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role,tenant_id:user.tenant_id,tenant_name:tenant?.name||null,tenant_plan:tenant?.plan||null,tenant_currency:tenant?.currency||null,tenant_distance_unit:tenant?.distance_unit||null}})
})
app.post('/api/auth/forgot-password', async (req,res)=>{
  const {email}=req.body
  if(!email?.trim())return res.status(400).json({error:t(req,'emailPasswordRequired')})
  const user=await one('SELECT * FROM users WHERE email=? AND active=1', [email.trim().toLowerCase()])
  if(user){
    const {randomBytes}=await import('node:crypto')
    const token=randomBytes(32).toString('hex')
    await run("UPDATE users SET reset_token=?,reset_token_expires_at=to_char(timezone('UTC',now())+interval '1 hour','YYYY-MM-DD HH24:MI:SS') WHERE id=?", [token, user.id])
    console.log(`[reset-senha] Link pra ${user.email}: /reset-password?token=${token} (expira em 1h). Sem provedor de e-mail configurado ainda — plugue um em server/messaging.js quando tiver.`)
  }
  res.json({message:t(req,'resetLinkSent')})
})
app.post('/api/auth/reset-password', async (req,res)=>{
  const {token,password}=req.body
  if(!token||!password||password.length<6)return res.status(400).json({error:t(req,'invalidResetRequest')})
  const user=await one("SELECT * FROM users WHERE reset_token=? AND reset_token_expires_at>to_char(timezone('UTC',now()),'YYYY-MM-DD HH24:MI:SS')", [token])
  if(!user)return res.status(400).json({error:t(req,'invalidOrExpiredToken')})
  await run('UPDATE users SET password_hash=?,reset_token=NULL,reset_token_expires_at=NULL WHERE id=?', [hashPassword(password), user.id])
  await logAudit({tenantId:user.tenant_id,userId:user.id,action:'password_reset',entity:'user',entityId:user.id})
  res.json({message:t(req,'passwordResetOk')})
})
app.use('/api',authenticate)
app.get('/api/auth/me',async(req,res)=>{const tenant=req.user.tenant_id?await one('SELECT * FROM tenants WHERE id=?', [req.user.tenant_id]):null;res.json({...req.user,tenant_name:tenant?.name||null,tenant_plan:tenant?.plan||null,tenant_currency:tenant?.currency||null,tenant_distance_unit:tenant?.distance_unit||null})})
app.post('/api/auth/totp/setup',async(req,res)=>{
  const {generateTotpSecret,totpUri}=await import('./auth.js')
  const secret=generateTotpSecret()
  await run('UPDATE users SET totp_secret=? WHERE id=?', [secret,req.user.id])
  res.json({secret,uri:totpUri(secret,req.user.email)})
})
app.post('/api/auth/totp/enable',async(req,res)=>{
  const {verifyTotp}=await import('./auth.js')
  const user=await one('SELECT * FROM users WHERE id=?', [req.user.id])
  if(!user.totp_secret)return res.status(400).json({error:t(req,'totpSetupRequired')})
  if(!verifyTotp(user.totp_secret,req.body.code))return res.status(400).json({error:t(req,'invalidTotp')})
  await run('UPDATE users SET totp_enabled=1 WHERE id=?', [req.user.id])
  await logAudit({tenantId:req.user.tenant_id,userId:req.user.id,action:'totp_enabled',entity:'user',entityId:req.user.id})
  res.json({message:t(req,'totpEnabled')})
})
app.post('/api/auth/totp/disable',async(req,res)=>{
  await run('UPDATE users SET totp_enabled=0,totp_secret=NULL WHERE id=?', [req.user.id])
  await logAudit({tenantId:req.user.tenant_id,userId:req.user.id,action:'totp_disabled',entity:'user',entityId:req.user.id})
  res.json({message:t(req,'totpDisabled')})
})
app.get('/api/admin/tenants',requireSuperAdmin,async(_,res)=>{res.json(await many('SELECT w.*,(SELECT COUNT(*) FROM users u WHERE u.tenant_id=w.id) user_count,(SELECT COUNT(*) FROM clients c WHERE c.tenant_id=w.id) client_count FROM tenants w ORDER BY w.id'))})
app.get('/api/admin/metrics',requireSuperAdmin,async(_,res)=>{
  const tenants=await one("SELECT COUNT(*) total,SUM(active) active FROM tenants")
  const clients=(await one('SELECT COUNT(*) total FROM clients')).total
  const vehicles=(await one('SELECT COUNT(*) total FROM vehicles')).total
  const users=(await one("SELECT COUNT(*) total FROM users WHERE role!='super_admin'")).total
  const orders=await one("SELECT COUNT(*) total,SUM(CASE WHEN status NOT IN ('entregue','cancelada') THEN 1 ELSE 0 END) open FROM service_orders")
  const revenue=(await one("SELECT COALESCE(SUM(paid_amount),0) total FROM service_orders WHERE payment_status IN ('pago','parcial')")).total
  const activeTenants=Number(tenants.active)||0,totalTenants=Number(tenants.total)||0
  res.json({
    total_workshops:totalTenants,
    active_workshops:activeTenants,
    inactive_workshops:totalTenants-activeTenants,
    total_clients:Number(clients),
    avg_clients_per_workshop:totalTenants?Math.round((clients/totalTenants)*10)/10:0,
    total_vehicles:Number(vehicles),
    total_users:Number(users),
    total_orders:Number(orders.total)||0,
    open_orders:Number(orders.open)||0,
    total_revenue:Number(revenue),
  })
})
app.post('/api/admin/tenants',requireSuperAdmin,async(req,res)=>{
  const {name,owner_name,owner_email,owner_password,plan='starter',currency='BRL',distance_unit='KM'}=req.body
  if(!name?.trim())return res.status(400).json({error:t(req,'tenantNameRequired')})
  if(!owner_name?.trim()||!owner_email?.trim()||!owner_password)return res.status(400).json({error:t(req,'emailPasswordRequired')})
  if(await one('SELECT id FROM users WHERE email=?', [owner_email.trim().toLowerCase()]))return res.status(409).json({error:t(req,'emailAlreadyRegistered')})
  if(!['starter','pro','scale'].includes(plan)||!['KM','MI'].includes(distance_unit))return res.status(400).json({error:t(req,'noValidFields')})
  const w=await run("INSERT INTO tenants (name,plan,status,currency,distance_unit) VALUES (?,?,'trial',?,?) RETURNING id", [name.trim(),plan,currency,distance_unit])
  await run("INSERT INTO users (tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,'owner') RETURNING id", [w.lastInsertRowid,owner_name.trim(),owner_email.trim().toLowerCase(),hashPassword(owner_password)])
  await ensureDefaultPipeline(w.lastInsertRowid)
  await logAudit({tenantId:null,userId:req.user.id,action:'tenant_created',entity:'tenant',entityId:w.lastInsertRowid})
  res.status(201).json(await one('SELECT * FROM tenants WHERE id=?', [w.lastInsertRowid]))
})
app.patch('/api/admin/tenants/:id',requireSuperAdmin,async(req,res)=>{
  const tenant=await one('SELECT id FROM tenants WHERE id=?', [req.params.id])
  if(!tenant)return missing(req,res,'tenant')
  const allowed=['active','plan','status','expires_at','currency','distance_unit'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k))
  if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')})
  if(req.body.plan!==undefined&&!['starter','pro','scale'].includes(req.body.plan))return res.status(400).json({error:t(req,'noValidFields')})
  if(req.body.status!==undefined&&!['trial','active','past_due','canceled'].includes(req.body.status))return res.status(400).json({error:t(req,'noValidFields')})
  await run(`UPDATE tenants SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>k==='active'?(v?1:0):v),tenant.id])
  await logAudit({tenantId:tenant.id,userId:req.user.id,action:'tenant_updated',entity:'tenant',entityId:tenant.id,metadata:req.body})
  res.json(await one('SELECT * FROM tenants WHERE id=?', [tenant.id]))
})
app.post('/api/admin/tenants/:id/checkout',requireSuperAdmin,async(req,res)=>{
  const tenant=await one('SELECT * FROM tenants WHERE id=?', [req.params.id])
  if(!tenant)return missing(req,res,'tenant')
  const {plan}=req.body
  if(!['starter','pro','scale'].includes(plan))return res.status(400).json({error:t(req,'noValidFields')})
  const session=await createCheckoutSession(tenant,plan)
  await logAudit({tenantId:tenant.id,userId:req.user.id,action:'checkout_started',entity:'tenant',entityId:tenant.id,metadata:{plan}})
  res.json(session)
})
app.use('/api',requireTenant,verifyTenantSubscription)

app.get('/api/dashboard',async(req,res)=>{
  const rawMetrics=await one("SELECT SUM(CASE WHEN status NOT IN ('entregue','cancelada') THEN 1 ELSE 0 END) open_orders,SUM(CASE WHEN status='aguardando_aprovacao' THEN 1 ELSE 0 END) awaiting_approval,SUM(CASE WHEN status='em_execucao' THEN 1 ELSE 0 END) in_progress,COALESCE(SUM(CASE WHEN payment_status='pago' AND to_char(updated_at::timestamp,'YYYY-MM')=to_char(timezone('UTC',now()),'YYYY-MM') THEN paid_amount ELSE 0 END),0) revenue FROM service_orders WHERE tenant_id=?", [req.tenantId])
  const metrics={open_orders:Number(rawMetrics.open_orders)||0,awaiting_approval:Number(rawMetrics.awaiting_approval)||0,in_progress:Number(rawMetrics.in_progress)||0,revenue:Number(rawMetrics.revenue)||0}
  const reminders=await many("SELECT r.*,c.name client_name,v.plate,v.brand,v.model FROM reminders r JOIN clients c ON c.id=r.client_id JOIN vehicles v ON v.id=r.vehicle_id WHERE r.tenant_id=? AND r.status='agendado' ORDER BY r.due_date LIMIT 5", [req.tenantId])
  const recent_activity=await many("SELECT vh.*,c.name client_name,so.number order_number FROM vehicle_history vh JOIN vehicles v ON v.id=vh.vehicle_id JOIN clients c ON c.id=v.client_id LEFT JOIN service_orders so ON so.id=vh.service_order_id WHERE vh.tenant_id=? ORDER BY vh.created_at DESC LIMIT 6", [req.tenantId])
  res.json({metrics,reminders,recent_activity})
})
app.get('/api/employees',async(req,res)=>{const active=req.query.active;let sql='SELECT * FROM employees WHERE tenant_id=?';const args=[req.tenantId];if(active!==undefined){sql+=' AND active=?';args.push(active==='1'?1:0)}res.json(await many(`${sql} ORDER BY name`, args))})
app.post('/api/employees',async(req,res)=>{const {name,role,phone=null,specialty=null,active=true}=req.body;if(!name?.trim()||!role?.trim())return res.status(400).json({error:t(req,'employeeNameRoleRequired')});const r=await run('INSERT INTO employees (tenant_id,name,role,phone,specialty,active) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),role.trim(),phone,specialty,active?1:0]);res.status(201).json(await one('SELECT * FROM employees WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/employees/:id',async(req,res)=>{const allowed=['name','role','phone','specialty','active'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const employee=await one('SELECT id FROM employees WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!employee)return missing(req,res,'employee');await run(`UPDATE employees SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>k==='active'?(v?1:0):v),employee.id]);res.json(await one('SELECT * FROM employees WHERE id=?', [employee.id]))})
const appointmentSelect=`SELECT a.*,c.name client_name,c.phone client_phone,v.plate,v.brand,v.model,e.name mechanic_name FROM appointments a JOIN clients c ON c.id=a.client_id LEFT JOIN vehicles v ON v.id=a.vehicle_id LEFT JOIN employees e ON e.id=a.mechanic_id`
app.get('/api/appointments',async(req,res)=>{const {start,end,mechanic_id}=req.query;let sql=`${appointmentSelect} WHERE a.tenant_id=?`;const args=[req.tenantId];if(start){sql+=' AND a.scheduled_at>=?';args.push(start)}if(end){sql+=' AND a.scheduled_at<=?';args.push(end)}if(mechanic_id){sql+=' AND a.mechanic_id=?';args.push(mechanic_id)}res.json(await many(`${sql} ORDER BY a.scheduled_at`, args))})
app.post('/api/appointments',async(req,res)=>{const {client_id,vehicle_id=null,mechanic_id=null,title,scheduled_at,duration_minutes=60,notes=null}=req.body;if(!client_id||!title?.trim()||!scheduled_at)return res.status(400).json({error:t(req,'appointmentRequiredFields')});if(!(await one('SELECT id FROM clients WHERE id=? AND tenant_id=?', [client_id,req.tenantId])))return missing(req,res,'client');const r=await run('INSERT INTO appointments (tenant_id,client_id,vehicle_id,mechanic_id,title,scheduled_at,duration_minutes,notes) VALUES (?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,client_id,vehicle_id,mechanic_id,title.trim(),scheduled_at,duration_minutes,notes]);res.status(201).json(await one(`${appointmentSelect} WHERE a.id=?`, [r.lastInsertRowid]))})
app.patch('/api/appointments/:id',async(req,res)=>{const allowed=['vehicle_id','mechanic_id','title','scheduled_at','duration_minutes','status','notes'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const appt=await one('SELECT id FROM appointments WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!appt)return missing(req,res,'appointment');await run(`UPDATE appointments SET ${entries.map(([k])=>`${k}=?`).join(',')},updated_at=now_text() WHERE id=?`, [...entries.map(([,v])=>v),appt.id]);res.json(await one(`${appointmentSelect} WHERE a.id=?`, [appt.id]))})
app.delete('/api/appointments/:id',async(req,res)=>{const r=await run('DELETE FROM appointments WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'appointment');res.json({message:'Agendamento removido.'})})
app.get('/api/automation-flows',requirePlan('scale'),async(req,res)=>res.json((await many('SELECT * FROM automation_flows WHERE tenant_id=? ORDER BY id DESC', [req.tenantId])).map(f=>({...f,steps:JSON.parse(f.steps)}))))
app.post('/api/automation-flows',requirePlan('scale'),async(req,res)=>{const {name,module,trigger_field,trigger_value,steps=[],active=true}=req.body;if(!name?.trim()||!trigger_field||!trigger_value)return res.status(400).json({error:t(req,'flowNameTriggerRequired')});if(!['service_orders','leads'].includes(module))return res.status(400).json({error:t(req,'invalidModule')});const r=await run('INSERT INTO automation_flows (tenant_id,name,module,trigger_field,trigger_value,steps,active) VALUES (?,?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),module,trigger_field,trigger_value,JSON.stringify(steps),active?1:0]);res.status(201).json({...(await one('SELECT * FROM automation_flows WHERE id=?', [r.lastInsertRowid])),steps})})
app.patch('/api/automation-flows/:id',requirePlan('scale'),async(req,res)=>{const flow=await one('SELECT * FROM automation_flows WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!flow)return missing(req,res,'automationFlow');const {name,trigger_value,steps,active}=req.body;const fields=[],args=[];if(name!==undefined){fields.push('name=?');args.push(name)}if(trigger_value!==undefined){fields.push('trigger_value=?');args.push(trigger_value)}if(steps!==undefined){fields.push('steps=?');args.push(JSON.stringify(steps))}if(active!==undefined){fields.push('active=?');args.push(active?1:0)}if(!fields.length)return res.status(400).json({error:t(req,'noValidFields')});await run(`UPDATE automation_flows SET ${fields.join(',')} WHERE id=?`, [...args,flow.id]);const updated=await one('SELECT * FROM automation_flows WHERE id=?', [flow.id]);res.json({...updated,steps:JSON.parse(updated.steps)})})
app.delete('/api/automation-flows/:id',requirePlan('scale'),async(req,res)=>{const r=await run('DELETE FROM automation_flows WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'automationFlow');res.json({message:'Fluxo removido.'})})
app.get('/api/automation-rules',async(req,res)=>res.json(await many('SELECT * FROM automation_rules WHERE tenant_id=? ORDER BY id DESC', [req.tenantId])))
app.post('/api/automation-rules',async(req,res)=>{const {name,module,field,value,channel='whatsapp',message_template,active=true}=req.body;if(!name?.trim()||!message_template?.trim())return res.status(400).json({error:t(req,'ruleNameMessageRequired')});if(!['service_orders','leads'].includes(module))return res.status(400).json({error:t(req,'invalidModule')});if(!field?.trim()||!value?.trim())return res.status(400).json({error:t(req,'ruleTriggerFieldRequired')});const r=await run('INSERT INTO automation_rules (tenant_id,name,module,field,value,channel,message_template,active) VALUES (?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),module,field.trim(),value.trim(),channel,message_template.trim(),active?1:0]);res.status(201).json(await one('SELECT * FROM automation_rules WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/automation-rules/:id',async(req,res)=>{const allowed=['name','field','value','channel','message_template','active'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const rule=await one('SELECT id FROM automation_rules WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!rule)return missing(req,res,'automationRule');await run(`UPDATE automation_rules SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>k==='active'?(v?1:0):v),rule.id]);res.json(await one('SELECT * FROM automation_rules WHERE id=?', [rule.id]))})
app.delete('/api/automation-rules/:id',async(req,res)=>{const r=await run('DELETE FROM automation_rules WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'automationRule');res.json({message:'Regra removida.'})})
app.get('/api/pipelines',async(req,res)=>{res.json((await many('SELECT * FROM pipelines WHERE tenant_id=? ORDER BY id', [req.tenantId])).map(p=>({...p,stages:stagesOf(p)})))})
app.post('/api/pipelines',async(req,res)=>{const {name,stages}=req.body;if(!name?.trim())return res.status(400).json({error:t(req,'pipelineNameRequired')});const labels=(Array.isArray(stages)?stages:[]).map(s=>typeof s==='string'?s:s?.label).filter(l=>l?.trim());if(!labels.length)return res.status(400).json({error:t(req,'pipelineStagesRequired')});const seen=new Set(),parsed=labels.map(label=>{const base=slugify(label)||'etapa';let key=base,i=2;while(seen.has(key))key=`${base}_${i++}`;seen.add(key);return {key,label:label.trim()}});const r=await run('INSERT INTO pipelines (tenant_id,name,stages) VALUES (?,?,?) RETURNING id', [req.tenantId,name.trim(),JSON.stringify(parsed)]);res.status(201).json({...(await one('SELECT * FROM pipelines WHERE id=?', [r.lastInsertRowid])),stages:parsed})})
app.get('/api/crm/board',async(req,res)=>{const pipeline=await getPipeline(req.tenantId,req.query.pipeline_id);if(!pipeline)return res.json([]);const stages=stagesOf(pipeline),leads=await many('SELECT * FROM leads WHERE pipeline_id=? AND tenant_id=? AND converted_client_id IS NULL ORDER BY updated_at DESC', [pipeline.id,req.tenantId]);res.json(stages.map(stage=>({...stage,leads:leads.filter(lead=>lead.stage===stage.key)})))})
app.get('/api/leads',async(req,res)=>{const q=`%${req.query.search||''}%`,stage=req.query.stage,pipelineId=req.query.pipeline_id;let sql='SELECT l.*,c.name converted_client_name FROM leads l LEFT JOIN clients c ON c.id=l.converted_client_id WHERE l.tenant_id=? AND (l.name ILIKE ? OR l.phone ILIKE ? OR l.email ILIKE ?)';const args=[req.tenantId,q,q,q];if(stage){sql+=' AND l.stage=?';args.push(stage)}if(pipelineId){sql+=' AND l.pipeline_id=?';args.push(pipelineId)}res.json(await many(`${sql} ORDER BY l.updated_at DESC`, args))})
app.post('/api/leads',async(req,res)=>{const {name,document=null,phone=null,email=null,source='manual',pipeline_id=null,stage,estimated_value=0,vehicle_interest=null,notes=null}=req.body;if(!name?.trim())return res.status(400).json({error:t(req,'leadNameRequired')});const pipeline=await getPipeline(req.tenantId,pipeline_id);if(!pipeline)return res.status(400).json({error:t(req,'invalidPipeline')});const stages=stagesOf(pipeline),stageKey=stage||stages[0]?.key;if(!stages.some(s=>s.key===stageKey))return res.status(400).json({error:t(req,'invalidStage')});const r=await run('INSERT INTO leads (tenant_id,name,document,phone,email,source,pipeline_id,stage,estimated_value,vehicle_interest,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),document,phone,email,source,pipeline.id,stageKey,estimated_value,vehicle_interest,notes]);res.status(201).json(await one('SELECT * FROM leads WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/leads/:id',async(req,res)=>{const allowed=['name','document','phone','email','source','pipeline_id','stage','estimated_value','vehicle_interest','notes'],entries=Object.entries(req.body).filter(([key])=>allowed.includes(key));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const lead=await one('SELECT * FROM leads WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!lead)return missing(req,res,'lead');if(req.body.stage){const pipeline=await getPipeline(req.tenantId,req.body.pipeline_id||lead.pipeline_id);if(!pipeline||!stagesOf(pipeline).some(s=>s.key===req.body.stage))return res.status(400).json({error:t(req,'invalidStage')})}await run(`UPDATE leads SET ${entries.map(([key])=>`${key}=?`).join(',')},updated_at=now_text() WHERE id=?`, [...entries.map(([,value])=>value),lead.id]);if(req.body.stage){await runAutomations(req.tenantId,'leads','stage',req.body.stage,lead.id);await startFlows(req.tenantId,'leads','stage',req.body.stage,lead.id)}res.json(await one('SELECT * FROM leads WHERE id=?', [lead.id]))})
app.post('/api/leads/:id/activities',async(req,res)=>{const lead=await one('SELECT id FROM leads WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!lead)return missing(req,res,'lead');const {type='contato',description,scheduled_at=null}=req.body;if(!description?.trim())return res.status(400).json({error:t(req,'activityDescriptionRequired')});const r=await run('INSERT INTO crm_activities (tenant_id,lead_id,type,description,scheduled_at) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,lead.id,type,description.trim(),scheduled_at]);res.status(201).json(await one('SELECT * FROM crm_activities WHERE id=?', [r.lastInsertRowid]))})
app.post('/api/leads/:id/convert',async(req,res)=>{const lead=await one('SELECT * FROM leads WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!lead)return missing(req,res,'lead');if(lead.converted_client_id)return res.status(409).json({error:t(req,'leadAlreadyConverted')});const existing=lead.document?await one('SELECT id FROM clients WHERE document=? AND tenant_id=?', [lead.document,req.tenantId]):null;let clientId=existing?.id;if(!clientId){const r=await run('INSERT INTO clients (tenant_id,name,document,phone,email,notes) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,lead.name,lead.document,lead.phone,lead.email,lead.notes]);clientId=r.lastInsertRowid}await run("UPDATE leads SET stage='ganho',converted_client_id=?,updated_at=now_text() WHERE id=?", [clientId,lead.id]);await run("INSERT INTO crm_activities (tenant_id,lead_id,client_id,type,description,completed_at) VALUES (?,?,?,?,?,now_text()) RETURNING id", [req.tenantId,lead.id,clientId,'conversao','Lead convertido em cliente.']);res.json({lead:await one('SELECT * FROM leads WHERE id=?', [lead.id]),client:await one('SELECT * FROM clients WHERE id=?', [clientId])})})
app.get('/api/leads/:id/activities',async(req,res)=>{const lead=await one('SELECT id FROM leads WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!lead)return missing(req,res,'lead');res.json(await many('SELECT * FROM crm_activities WHERE lead_id=? ORDER BY created_at DESC', [lead.id]))})
app.get('/api/conversations',async(req,res)=>{const rows=await many(`SELECT m.*,CASE WHEN m.client_id IS NOT NULL THEN c.name ELSE l.name END contact_name,CASE WHEN m.client_id IS NOT NULL THEN c.phone ELSE l.phone END contact_phone FROM crm_messages m LEFT JOIN clients c ON c.id=m.client_id LEFT JOIN leads l ON l.id=m.lead_id WHERE m.tenant_id=? AND m.id IN (SELECT MAX(id) FROM crm_messages WHERE tenant_id=? GROUP BY client_id,lead_id) ORDER BY m.created_at DESC`, [req.tenantId,req.tenantId]);res.json(rows)})
app.get('/api/messages',async(req,res)=>{const {lead_id,client_id}=req.query;if(!lead_id&&!client_id)return res.status(400).json({error:t(req,'leadOrClientRequired')});const field=lead_id?'lead_id':'client_id',value=lead_id||client_id;res.json(await many(`SELECT * FROM crm_messages WHERE ${field}=? AND tenant_id=? ORDER BY created_at DESC`, [value,req.tenantId]))})
app.post('/api/messages',async(req,res)=>{const {lead_id=null,client_id=null,channel='whatsapp',recipient,content,send_now=true}=req.body;if(!lead_id&&!client_id)return res.status(400).json({error:t(req,'messageRecipientRequired')});if(!recipient||!content?.trim())return res.status(400).json({error:t(req,'recipientContentRequired')});if(!['whatsapp','instagram'].includes(channel))return res.status(400).json({error:t(req,'invalidChannel')});const r=await run("INSERT INTO crm_messages (tenant_id,lead_id,client_id,channel,direction,recipient,content,status) VALUES (?,?,?,?,'saida',?,?,'fila') RETURNING id", [req.tenantId,lead_id,client_id,channel,recipient,content.trim()]);const message=await one('SELECT * FROM crm_messages WHERE id=?', [r.lastInsertRowid]);if(!send_now)return res.status(201).json(message);sendExternalMessage({channel,recipient,content:message.content}).then(async result=>{await run("UPDATE crm_messages SET status='enviado',provider_message_id=?,sent_at=now_text() WHERE id=?", [result.id,message.id])}).catch(async error=>{await run("UPDATE crm_messages SET status='erro',error=? WHERE id=?", [error.message,message.id])});res.status(202).json({...message,status:'processando'})})
app.post('/api/messages/:id/retry',async(req,res)=>{const message=await one('SELECT * FROM crm_messages WHERE id=? AND direction=\'saida\' AND tenant_id=?', [req.params.id,req.tenantId]);if(!message)return missing(req,res,'message');try{const result=await sendExternalMessage({channel:message.channel,recipient:message.recipient,content:message.content});await run("UPDATE crm_messages SET status='enviado',provider_message_id=?,error=NULL,sent_at=now_text() WHERE id=?", [result.id,message.id]);res.json({message:'Mensagem enviada.',provider_message_id:result.id})}catch(error){await run("UPDATE crm_messages SET status='erro',error=? WHERE id=?", [error.message,message.id]);res.status(502).json({error:error.message})}})
app.get('/api/clients',async(req,res)=>{const q=`%${req.query.search||''}%`;res.json(await many('SELECT * FROM clients WHERE tenant_id=? AND (name ILIKE ? OR document ILIKE ? OR phone ILIKE ?) ORDER BY name', [req.tenantId,q,q,q]))})
app.post('/api/clients',async(req,res)=>{const {name,document=null,phone=null,email=null,whatsapp_opt_in=true,notes=null}=req.body;if(!name?.trim())return res.status(400).json({error:t(req,'clientNameRequired')});try{const r=await run('INSERT INTO clients (tenant_id,name,document,phone,email,whatsapp_opt_in,notes) VALUES (?,?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),document,phone,email,whatsapp_opt_in?1:0,notes]);res.status(201).json(await one('SELECT * FROM clients WHERE id=?', [r.lastInsertRowid]))}catch{res.status(409).json({error:t(req,'documentAlreadyRegistered')})}})
const csvEscape=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function parseCsv(text){
  const rows=[]
  let row=[],field='',inQuotes=false
  const pushField=()=>{row.push(field);field=''}
  const pushRow=()=>{pushField();rows.push(row);row=[]}
  for(let i=0;i<text.length;i++){
    const c=text[i]
    if(inQuotes){
      if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else inQuotes=false}
      else field+=c
    }else{
      if(c==='"')inQuotes=true
      else if(c===',')pushField()
      else if(c==='\n'){if(field||row.length)pushRow()}
      else if(c==='\r'){}
      else field+=c
    }
  }
  if(field||row.length)pushRow()
  return rows
}
app.get('/api/clients/export',async(req,res)=>{
  const clients=await many('SELECT name,document,phone,email,notes FROM clients WHERE tenant_id=? ORDER BY name', [req.tenantId])
  const header=['nome','cpf_cnpj','telefone','email','observacoes']
  const lines=[header.join(','),...clients.map(c=>[c.name,c.document,c.phone,c.email,c.notes].map(csvEscape).join(','))]
  res.setHeader('Content-Type','text/csv; charset=utf-8')
  res.setHeader('Content-Disposition','attachment; filename="clientes.csv"')
  res.send('﻿'+lines.join('\n'))
})
app.post('/api/clients/import',async(req,res)=>{
  const {csv}=req.body
  if(!csv?.trim())return res.status(400).json({error:t(req,'csvRequired')})
  const rows=parseCsv(csv.trim()).filter(r=>r.length>1||r[0])
  if(!rows.length)return res.status(400).json({error:t(req,'csvRequired')})
  const header=rows[0].map(h=>h.trim().toLowerCase())
  const nameIdx=header.findIndex(h=>['nome','name'].includes(h))
  const docIdx=header.findIndex(h=>['cpf_cnpj','documento','document','cpf'].includes(h))
  const phoneIdx=header.findIndex(h=>['telefone','phone'].includes(h))
  const emailIdx=header.findIndex(h=>['email','e-mail'].includes(h))
  const notesIdx=header.findIndex(h=>['observacoes','observações','notes'].includes(h))
  if(nameIdx===-1)return res.status(400).json({error:t(req,'csvMissingNameColumn')})
  let imported=0,skipped=0
  const duplicates=[]
  for(const row of rows.slice(1)){
    const name=row[nameIdx]?.trim()
    if(!name){skipped++;continue}
    const document=docIdx>-1?(row[docIdx]?.trim()||null):null
    const phone=phoneIdx>-1?(row[phoneIdx]?.trim()||null):null
    const email=emailIdx>-1?(row[emailIdx]?.trim()||null):null
    const notes=notesIdx>-1?(row[notesIdx]?.trim()||null):null
    try{
      await run('INSERT INTO clients (tenant_id,name,document,phone,email,notes) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,name,document,phone,email,notes])
      imported++
    }catch{skipped++;if(document)duplicates.push(document)}
  }
  await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'clients_imported',entity:'client',metadata:{imported,skipped}})
  res.json({imported,skipped,duplicates})
})
app.get('/api/clients/:id',async(req,res)=>{const client=await one('SELECT * FROM clients WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!client)return missing(req,res,'client');client.vehicles=await many('SELECT * FROM vehicles WHERE client_id=? ORDER BY updated_at DESC', [client.id]);res.json(client)})
app.get('/api/clients/:id/export',async(req,res)=>{
  const client=await one('SELECT * FROM clients WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId])
  if(!client)return missing(req,res,'client')
  const vehicles=await many('SELECT * FROM vehicles WHERE client_id=?', [client.id])
  const orders=await many('SELECT * FROM service_orders WHERE client_id=?', [client.id])
  const messages=await many('SELECT * FROM crm_messages WHERE client_id=?', [client.id])
  const activities=await many('SELECT * FROM crm_activities WHERE client_id=?', [client.id])
  res.json({client,vehicles,service_orders:orders,messages,activities})
})
app.post('/api/clients/:id/anonymize',async(req,res)=>{
  const client=await one('SELECT * FROM clients WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId])
  if(!client)return missing(req,res,'client')
  await run("UPDATE clients SET name=?,document=NULL,phone=NULL,email=NULL,notes=NULL,anonymized_at=now_text() WHERE id=?", [t(req,'anonymizedClientName'),client.id])
  await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'client_anonymized',entity:'client',entityId:client.id})
  res.json({message:t(req,'clientAnonymized')})
})
app.get('/api/vehicles',async(req,res)=>{const q=`%${req.query.search||''}%`;res.json(await many('SELECT v.*,c.name client_name,c.phone client_phone FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.tenant_id=? AND (v.plate ILIKE ? OR v.chassis ILIKE ? OR c.name ILIKE ?) ORDER BY v.updated_at DESC', [req.tenantId,q,q,q]))})
app.post('/api/vehicles',async(req,res)=>{const {client_id,plate:raw,chassis=null,brand,model,version=null,year_model=null,color=null,fuel=null,mileage=0,notes=null}=req.body;if(!client_id||!brand||!model)return res.status(400).json({error:t(req,'vehicleRequiredFields')});if(!(await one('SELECT id FROM clients WHERE id=? AND tenant_id=?', [client_id,req.tenantId])))return missing(req,res,'client');try{const r=await run('INSERT INTO vehicles (tenant_id,client_id,plate,chassis,brand,model,version,year_model,color,fuel,mileage,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,client_id,raw?plate(raw):null,chassis,brand,model,version,year_model,color,fuel,mileage,notes]);await run('INSERT INTO vehicle_owners (tenant_id,vehicle_id,client_id) VALUES (?,?,?) RETURNING id', [req.tenantId,r.lastInsertRowid,client_id]);res.status(201).json(await one('SELECT * FROM vehicles WHERE id=?', [r.lastInsertRowid]))}catch{res.status(409).json({error:t(req,'plateOrChassisRegistered')})}})
app.get('/api/vehicles/:id',async(req,res)=>{const vehicle=await one('SELECT v.*,c.name client_name,c.phone client_phone FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.id=? AND v.tenant_id=?', [req.params.id,req.tenantId]);if(!vehicle)return missing(req,res,'vehicle');vehicle.history=await many('SELECT * FROM vehicle_history WHERE vehicle_id=? ORDER BY created_at DESC', [vehicle.id]);vehicle.owners=await many('SELECT vo.*,c.name client_name FROM vehicle_owners vo JOIN clients c ON c.id=vo.client_id WHERE vo.vehicle_id=? ORDER BY started_at DESC', [vehicle.id]);vehicle.reminders=await many("SELECT * FROM reminders WHERE vehicle_id=? AND status='agendado' ORDER BY due_date", [vehicle.id]);res.json(vehicle)})
app.patch('/api/vehicles/:id/owner',async(req,res)=>{const vehicle=await one('SELECT * FROM vehicles WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!vehicle)return missing(req,res,'vehicle');const {client_id}=req.body;if(!client_id||!(await one('SELECT id FROM clients WHERE id=? AND tenant_id=?', [client_id,req.tenantId])))return res.status(400).json({error:t(req,'invalidClient')});if(Number(client_id)===vehicle.client_id)return res.status(400).json({error:t(req,'alreadyOwner')});await run('UPDATE vehicle_owners SET ended_at=now_text() WHERE vehicle_id=? AND ended_at IS NULL', [vehicle.id]);await run('INSERT INTO vehicle_owners (tenant_id,vehicle_id,client_id) VALUES (?,?,?) RETURNING id', [req.tenantId,vehicle.id,client_id]);await run('UPDATE vehicles SET client_id=?,updated_at=now_text() WHERE id=?', [client_id,vehicle.id]);await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,event_type,description,mileage) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,vehicle.id,'transferencia','Veículo transferido para novo proprietário.',vehicle.mileage]);res.json(await one('SELECT * FROM vehicles WHERE id=?', [vehicle.id]))})
const VIN_RE=/^[A-HJ-NPR-Z0-9]{11,17}$/i
app.get('/api/proxy/vin/:vin',async(req,res)=>{
  const vin=req.params.vin.toUpperCase()
  if(!VIN_RE.test(vin))return res.status(400).json({error:t(req,'invalidVin')})
  try{
    const r=await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${encodeURIComponent(vin)}?format=json`)
    const data=await r.json()
    const results=data.Results||[]
    const get=(name)=>results.find(x=>x.Variable===name)?.Value||null
    res.json({make:get('Make'),model:get('Model'),model_year:get('Model Year'),engine_hp:get('Engine Brake (hp) From'),fuel:get('Fuel Type - Primary')})
  }catch{res.status(502).json({error:t(req,'vinLookupFailed')})}
})
const MAKE_MODEL_RE=/^[A-Za-z0-9 \-]{1,40}$/
app.get('/api/proxy/recalls/:make/:model/:year',async(req,res)=>{
  const {make,model,year}=req.params
  if(!MAKE_MODEL_RE.test(make)||!MAKE_MODEL_RE.test(model)||!/^\d{4}$/.test(year))return res.status(400).json({error:t(req,'invalidRecallQuery')})
  try{
    const r=await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`)
    const data=await r.json()
    const recalls=data.results||[]
    res.json({count:recalls.length,recalls:recalls.slice(0,10)})
  }catch{res.status(502).json({error:t(req,'recallLookupFailed')})}
})
app.get('/api/orders',async(req,res)=>{const q=`%${req.query.search||''}%`,args=[req.tenantId,q,q,q,q];let sql=`${orderSelect} WHERE so.tenant_id=? AND (so.number ILIKE ? OR v.plate ILIKE ? OR c.name ILIKE ? OR v.model ILIKE ?)`;if(req.query.status){sql+=' AND so.status=?';args.push(req.query.status)}res.json(await many(`${sql} ORDER BY so.checkin_at DESC`, args))})
app.get('/api/orders/:id',async(req,res)=>{const order=await one(`${orderSelect} WHERE (so.id::text=? OR so.number=?) AND so.tenant_id=?`, [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');order.items=await many('SELECT *,quantity*unit_price total FROM order_items WHERE service_order_id=? ORDER BY id', [order.id]);order.history=await many('SELECT * FROM vehicle_history WHERE vehicle_id=? ORDER BY created_at DESC', [order.vehicle_id]);order.checklists=(await many('SELECT * FROM checklists WHERE service_order_id=?', [order.id])).map(c=>({...c,items:JSON.parse(c.items)}));order.payments=await many('SELECT * FROM payments WHERE service_order_id=? ORDER BY created_at', [order.id]);res.json(order)})
app.post('/api/orders/:id/payments',async(req,res)=>{const order=await one('SELECT id FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');const existingCount=(await one('SELECT COUNT(*) n FROM payments WHERE service_order_id=?', [order.id])).n;if(existingCount>0&&!['pro','scale'].includes(req.tenant?.plan))return res.status(403).json({error:t(req,'planUpgradeRequired')});const {method,amount,installments=1}=req.body;if(!['pix','cartao_credito','cartao_debito','dinheiro','boleto'].includes(method))return res.status(400).json({error:t(req,'invalidPaymentMethod')});if(!(Number(amount)>0))return res.status(400).json({error:t(req,'invalidPaymentAmount')});await run('INSERT INTO payments (tenant_id,service_order_id,method,amount,installments) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,order.id,method,Number(amount),method==='cartao_credito'?Math.max(1,Number(installments)||1):1]);const summary=await recalculatePaymentStatus(order.id);await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'payment_added',entity:'service_order',entityId:order.id,metadata:{method,amount}});res.status(201).json({payments:await many('SELECT * FROM payments WHERE service_order_id=? ORDER BY created_at', [order.id]),...summary})})
app.delete('/api/orders/:id/payments/:paymentId',async(req,res)=>{const order=await one('SELECT id FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');const r=await run('DELETE FROM payments WHERE id=? AND service_order_id=?', [req.params.paymentId,order.id]);if(!r.changes)return missing(req,res,'payment');const summary=await recalculatePaymentStatus(order.id);await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'payment_removed',entity:'service_order',entityId:order.id});res.json({payments:await many('SELECT * FROM payments WHERE service_order_id=? ORDER BY created_at', [order.id]),...summary})})
app.put('/api/orders/:id/checklist',async(req,res)=>{const order=await one('SELECT id FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');const {type,items,fuel_level=null,mileage=null,notes=null}=req.body;if(!['entrada','saida'].includes(type))return res.status(400).json({error:t(req,'invalidChecklistType')});if(!Array.isArray(items)||!items.length)return res.status(400).json({error:t(req,'checklistItemsRequired')});const normalized=items.map(i=>({label:String(i.label||'').trim(),checked:!!i.checked,notes:i.notes||null,photo:i.photo||null})).filter(i=>i.label);await run('INSERT INTO checklists (tenant_id,service_order_id,type,items,fuel_level,mileage,notes,completed_at) VALUES (?,?,?,?,?,?,?,now_text()) ON CONFLICT(service_order_id,type) DO UPDATE SET items=excluded.items,fuel_level=excluded.fuel_level,mileage=excluded.mileage,notes=excluded.notes,completed_at=now_text()', [req.tenantId,order.id,type,JSON.stringify(normalized),fuel_level,mileage,notes]);const saved=await one('SELECT * FROM checklists WHERE service_order_id=? AND type=?', [order.id,type]);res.json({...saved,items:JSON.parse(saved.items)})})
app.post('/api/orders',async(req,res)=>{const {client_id,vehicle_id,mechanic_id=null,mileage_in,customer_complaint=null,priority='normal',fuel_level=null,estimated_delivery_at=null}=req.body;if(!client_id||!vehicle_id||mileage_in===undefined)return res.status(400).json({error:t(req,'checkinRequiredFields')});const vehicle=await one('SELECT * FROM vehicles WHERE id=? AND client_id=? AND tenant_id=?', [vehicle_id,client_id,req.tenantId]);if(!vehicle)return res.status(400).json({error:t(req,'vehicleNotOwnedByClient')});const number=await nextOrderNumber(),r=await run('INSERT INTO service_orders (tenant_id,number,client_id,vehicle_id,mechanic_id,mileage_in,customer_complaint,priority,fuel_level,estimated_delivery_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,number,client_id,vehicle_id,mechanic_id,mileage_in,customer_complaint,priority,fuel_level,estimated_delivery_at]);await run('UPDATE vehicles SET mileage=?,updated_at=now_text() WHERE id=?', [mileage_in,vehicle_id]);await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,vehicle_id,r.lastInsertRowid,'entrada',`Check-in realizado na ${number}.`,mileage_in]);res.status(201).json(await one(`${orderSelect} WHERE so.id=?`, [r.lastInsertRowid]))})
app.post('/api/checkin',async(req,res)=>{
  const {client_name,client_phone=null,plate:rawPlate,brand=null,model=null,mileage,complaint=null,fuel_level=null,checklist_items=null}=req.body
  if(!client_name?.trim()||!rawPlate||mileage===undefined)return res.status(400).json({error:t(req,'checkinBasicRequired')})
  const normalized=plate(rawPlate)
  let vehicle=await one('SELECT * FROM vehicles WHERE plate=? AND tenant_id=?', [normalized,req.tenantId]), client
  if(vehicle){
    client=await one('SELECT * FROM clients WHERE id=?', [vehicle.client_id])
  }else{
    client=await one('SELECT * FROM clients WHERE (name=? OR phone=?) AND tenant_id=? LIMIT 1', [client_name.trim(),client_phone,req.tenantId])
    if(!client){const created=await run('INSERT INTO clients (tenant_id,name,phone) VALUES (?,?,?) RETURNING id', [req.tenantId,client_name.trim(),client_phone]);client=await one('SELECT * FROM clients WHERE id=?', [created.lastInsertRowid])}
    const created=await run('INSERT INTO vehicles (tenant_id,client_id,plate,brand,model,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,client.id,normalized,brand?.trim()||'Não informada',model?.trim()||'Não informado',mileage])
    vehicle=await one('SELECT * FROM vehicles WHERE id=?', [created.lastInsertRowid])
    await run('INSERT INTO vehicle_owners (tenant_id,vehicle_id,client_id) VALUES (?,?,?) RETURNING id', [req.tenantId,vehicle.id,client.id])
  }
  const number=await nextOrderNumber(), created=await run('INSERT INTO service_orders (tenant_id,number,client_id,vehicle_id,mileage_in,customer_complaint,fuel_level) VALUES (?,?,?,?,?,?,?) RETURNING id', [req.tenantId,number,client.id,vehicle.id,mileage,complaint,fuel_level])
  await run('UPDATE vehicles SET mileage=?,updated_at=now_text() WHERE id=?', [mileage,vehicle.id])
  await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,vehicle.id,created.lastInsertRowid,'entrada',`Check-in realizado na ${number}.`,mileage])
  if(Array.isArray(checklist_items)&&checklist_items.length){
    const normalizedItems=checklist_items.map(i=>({label:String(i.label||'').trim(),checked:!!i.checked,notes:i.notes||null,photo:i.photo||null})).filter(i=>i.label)
    if(normalizedItems.length)await run('INSERT INTO checklists (tenant_id,service_order_id,type,items,fuel_level,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,created.lastInsertRowid,'entrada',JSON.stringify(normalizedItems),fuel_level,mileage])
  }
  res.status(201).json(await one(`${orderSelect} WHERE so.id=?`, [created.lastInsertRowid]))
})
app.patch('/api/orders/:id',async(req,res)=>{const allowed=['status','priority','mechanic_id','diagnosis','solution','internal_notes','discount','paid_amount','payment_status','payment_method','mileage_out','estimated_delivery_at','completed_at','delivered_at'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const order=await one('SELECT * FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');await run(`UPDATE service_orders SET ${entries.map(([k])=>`${k}=?`).join(',')},updated_at=now_text() WHERE id=?`, [...entries.map(([,v])=>v),order.id]);if(req.body.mileage_out)await run('UPDATE vehicles SET mileage=?,updated_at=now_text() WHERE id=?', [req.body.mileage_out,order.vehicle_id]);if(req.body.status){await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,order.vehicle_id,order.id,'status',`OS alterada para: ${req.body.status}.`,req.body.mileage_out||order.mileage_in]);await runAutomations(req.tenantId,'service_orders','status',req.body.status,order.id);await startFlows(req.tenantId,'service_orders','status',req.body.status,order.id)}if(req.body.discount!==undefined)await recalculateOrderTotal(order.id);res.json(await one(`${orderSelect} WHERE so.id=?`, [order.id]))})
app.post('/api/orders/:id/items',async(req,res)=>{
  const order=await one('SELECT * FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId])
  if(!order)return missing(req,res,'order')
  let {type,description,quantity=1,unit_price=0,approved=false,completed=false,warranty_days=null,catalog_item_id=null}=req.body
  let catalogItem=null
  if(catalog_item_id){
    catalogItem=await one('SELECT * FROM catalog_items WHERE id=? AND tenant_id=?', [catalog_item_id,req.tenantId])
    if(!catalogItem)return missing(req,res,'catalogItem')
    type=type||catalogItem.type
    description=description||catalogItem.name
    if(req.body.unit_price===undefined)unit_price=catalogItem.unit_price
  }
  if(!['peca','servico','taxa'].includes(type)||!description)return res.status(400).json({error:t(req,'itemTypeDescriptionRequired')})
  const r=await run('INSERT INTO order_items (tenant_id,service_order_id,type,description,quantity,unit_price,approved,completed,warranty_days,catalog_item_id) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,order.id,type,description,quantity,unit_price,approved?1:0,completed?1:0,warranty_days,catalogItem?.id||null])
  if(catalogItem?.track_stock){
    await run('UPDATE catalog_items SET quantity=quantity-? WHERE id=?', [Number(quantity),catalogItem.id])
    await run('INSERT INTO stock_movements (tenant_id,catalog_item_id,delta,reason,service_order_id) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,catalogItem.id,-Number(quantity),`Baixa automática na ${order.number}`,order.id])
  }
  res.status(201).json({item:await one('SELECT * FROM order_items WHERE id=?', [r.lastInsertRowid]),total_amount:await recalculateOrderTotal(order.id)})
})
app.post('/api/orders/:id/history',async(req,res)=>{const order=await one('SELECT * FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');const {event_type='observacao',description,mileage=order.mileage_in}=req.body;if(!description?.trim())return res.status(400).json({error:t(req,'historyDescriptionRequired')});const r=await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,order.vehicle_id,order.id,event_type,description.trim(),mileage]);res.status(201).json(await one('SELECT * FROM vehicle_history WHERE id=?', [r.lastInsertRowid]))})
app.post('/api/orders/:id/invoice',async(req,res)=>{
  const order=await one('SELECT * FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId])
  if(!order)return missing(req,res,'order')
  const existing=await one("SELECT * FROM invoices WHERE service_order_id=? AND status='emitida'", [order.id])
  if(existing)return res.status(409).json({error:t(req,'invoiceAlreadyIssued'),invoice:existing})
  const items=await many("SELECT * FROM order_items WHERE service_order_id=? AND approved=1", [order.id])
  if(!items.length)return res.status(400).json({error:t(req,'noApprovedItems')})
  const laborAmount=items.filter(i=>i.type==='servico').reduce((sum,i)=>sum+i.quantity*i.unit_price,0)
  const partsAmount=items.filter(i=>i.type!=='servico').reduce((sum,i)=>sum+i.quantity*i.unit_price,0)
  const totalAmount=Math.max(0,laborAmount+partsAmount-(order.discount||0))
  const number=await nextInvoiceNumber()
  const r=await run('INSERT INTO invoices (tenant_id,number,service_order_id,client_id,labor_amount,parts_amount,discount,total_amount) VALUES (?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,number,order.id,order.client_id,laborAmount,partsAmount,order.discount||0,totalAmount])
  for(const item of items) await run('INSERT INTO invoice_items (tenant_id,invoice_id,order_item_id,type,description,quantity,unit_price) VALUES (?,?,?,?,?,?,?) RETURNING id', [req.tenantId,r.lastInsertRowid,item.id,item.type,item.description,item.quantity,item.unit_price])
  const invoice=await one('SELECT * FROM invoices WHERE id=?', [r.lastInsertRowid])
  invoice.items=await many('SELECT * FROM invoice_items WHERE invoice_id=?', [invoice.id])
  res.status(201).json(invoice)
})
app.get('/api/invoices',async(req,res)=>{const status=req.query.status;let sql="SELECT i.*,c.name client_name,so.number order_number FROM invoices i JOIN clients c ON c.id=i.client_id JOIN service_orders so ON so.id=i.service_order_id WHERE i.tenant_id=?";const args=[req.tenantId];if(status){sql+=' AND i.status=?';args.push(status)}res.json(await many(`${sql} ORDER BY i.id DESC`, args))})
app.get('/api/invoices/:id',async(req,res)=>{const invoice=await one("SELECT i.*,c.name client_name,so.number order_number FROM invoices i JOIN clients c ON c.id=i.client_id JOIN service_orders so ON so.id=i.service_order_id WHERE i.id=? AND i.tenant_id=?", [req.params.id,req.tenantId]);if(!invoice)return missing(req,res,'invoice');invoice.items=await many('SELECT * FROM invoice_items WHERE invoice_id=?', [invoice.id]);res.json(invoice)})
app.patch('/api/invoices/:id/cancel',async(req,res)=>{const r=await run("UPDATE invoices SET status='cancelada' WHERE id=? AND status='emitida' AND tenant_id=?", [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'invoice');res.json({message:'Fatura cancelada.'})})
app.get('/api/reminders',async(req,res)=>{const status=req.query.status||'agendado';res.json(await many('SELECT r.*,c.name client_name,v.plate,v.brand,v.model FROM reminders r JOIN clients c ON c.id=r.client_id JOIN vehicles v ON v.id=r.vehicle_id WHERE r.status=? AND r.tenant_id=? ORDER BY r.due_date', [status,req.tenantId]))})
app.post('/api/reminders',async(req,res)=>{const {client_id,vehicle_id,service_order_id=null,type,due_date=null,due_mileage=null,channel='whatsapp',message=null}=req.body;if(!client_id||!vehicle_id||!type)return res.status(400).json({error:t(req,'reminderRequiredFields')});const r=await run('INSERT INTO reminders (tenant_id,client_id,vehicle_id,service_order_id,type,due_date,due_mileage,channel,message) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,client_id,vehicle_id,service_order_id,type,due_date,due_mileage,channel,message]);res.status(201).json(await one('SELECT * FROM reminders WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/reminders/:id/send',async(req,res)=>{const r=await run("UPDATE reminders SET status='enviado',sent_at=now_text() WHERE id=? AND tenant_id=?", [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'reminder');res.json({message:'Lembrete marcado como enviado.'})})
async function createMaintenanceReminder(req,res,forcedType){
  const {client_id,vehicle_id,service_order_id=null,type=forcedType||'outro',current_mileage,interval_mileage=null,interval_days=null,channel='whatsapp'}=req.body
  if(!client_id||!vehicle_id||(interval_mileage==null&&interval_days==null))return res.status(400).json({error:t(req,'oilReminderRequiredFields')})
  const vehicle=await one('SELECT v.*,c.name client_name,c.phone FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.id=? AND v.client_id=? AND v.tenant_id=?', [vehicle_id,client_id,req.tenantId])
  if(!vehicle)return res.status(400).json({error:t(req,'vehicleNotOwnedByClient')})
  const dueMileage=interval_mileage!=null?Number(current_mileage||vehicle.mileage)+Number(interval_mileage):null
  let dueDate=null
  if(interval_days!=null){dueDate=new Date();dueDate.setDate(dueDate.getDate()+Number(interval_days))}
  const message=oilMessage({client:vehicle.client_name,vehicle,dueMileage,dueDate,type})
  const r=await run('INSERT INTO reminders (tenant_id,client_id,vehicle_id,service_order_id,type,due_date,due_mileage,channel,message) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,client_id,vehicle_id,service_order_id,type,dueDate?dueDate.toISOString():null,dueMileage,channel,message])
  res.status(201).json({reminder:await one('SELECT * FROM reminders WHERE id=?', [r.lastInsertRowid]),message})
}
app.post('/api/reminders/maintenance',(req,res)=>createMaintenanceReminder(req,res,null))
app.post('/api/reminders/oil',(req,res)=>createMaintenanceReminder(req,res,'troca_oleo'))
app.get('/api/notifications/pending',async(req,res)=>res.json((await dueReminders(req.tenantId)).map(r=>({...r,message:r.message||oilMessage({client:r.client_name,vehicle:r,dueMileage:r.due_mileage,dueDate:r.due_date,type:r.type})}))))
app.post('/api/notifications/process',async(req,res)=>{const reminders=await dueReminders(req.tenantId);let created=0;for(const r of reminders){const already=await one("SELECT id FROM notification_logs WHERE reminder_id=? AND status IN ('pronto_para_envio','enviado')", [r.id]);if(!already){await run("INSERT INTO notification_logs (tenant_id,reminder_id,channel,status,recipient,message) VALUES (?,?,?,'pronto_para_envio',?,?) RETURNING id", [req.tenantId,r.id,r.channel,r.phone,r.message||oilMessage({client:r.client_name,vehicle:r,dueMileage:r.due_mileage,dueDate:r.due_date,type:r.type})]);created++}}res.json({due:reminders.length,queued:created,message:'Notificações de manutenção processadas.'})})
app.get('/api/notifications',async(req,res)=>{const status=req.query.status||'pronto_para_envio';res.json(await many('SELECT n.*,r.type,c.name client_name,v.plate FROM notification_logs n JOIN reminders r ON r.id=n.reminder_id JOIN clients c ON c.id=r.client_id JOIN vehicles v ON v.id=r.vehicle_id WHERE n.status=? AND n.tenant_id=? ORDER BY n.created_at DESC', [status,req.tenantId]))})
app.post('/api/notifications/:id/send',async(req,res)=>{const log=await one('SELECT * FROM notification_logs WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!log)return missing(req,res,'notification');await run("UPDATE notification_logs SET status='enviado',sent_at=now_text() WHERE id=?", [log.id]);await run("UPDATE reminders SET status='enviado',sent_at=now_text() WHERE id=?", [log.reminder_id]);res.json({message:'Notificação marcada como enviada.',notification_id:log.id})})

app.get('/api/catalog',async(req,res)=>{const q=`%${req.query.search||''}%`;let sql='SELECT * FROM catalog_items WHERE tenant_id=? AND active=1 AND (name ILIKE ? OR sku ILIKE ?)';const args=[req.tenantId,q,q];if(req.query.type){sql+=' AND type=?';args.push(req.query.type)}if(req.query.low_stock==='1')sql+=' AND track_stock=1 AND quantity<=min_quantity';res.json(await many(`${sql} ORDER BY name`, args))})
app.post('/api/catalog',async(req,res)=>{const {type,name,sku=null,unit_price=0,cost_price=0,track_stock=false,quantity=0,min_quantity=0}=req.body;if(!['peca','servico'].includes(type)||!name?.trim())return res.status(400).json({error:t(req,'catalogItemRequiredFields')});try{const r=await run('INSERT INTO catalog_items (tenant_id,type,name,sku,unit_price,cost_price,track_stock,quantity,min_quantity) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', [req.tenantId,type,name.trim(),sku||null,unit_price,cost_price,track_stock?1:0,quantity,min_quantity]);res.status(201).json(await one('SELECT * FROM catalog_items WHERE id=?', [r.lastInsertRowid]))}catch{res.status(409).json({error:t(req,'catalogSkuRegistered')})}})
app.patch('/api/catalog/:id',async(req,res)=>{const allowed=['name','sku','unit_price','cost_price','track_stock','min_quantity','active'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const item=await one('SELECT id FROM catalog_items WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!item)return missing(req,res,'catalogItem');try{await run(`UPDATE catalog_items SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>['track_stock','active'].includes(k)?(v?1:0):k==='sku'?(v||null):v),item.id]);res.json(await one('SELECT * FROM catalog_items WHERE id=?', [item.id]))}catch{res.status(409).json({error:t(req,'catalogSkuRegistered')})}})
app.delete('/api/catalog/:id',async(req,res)=>{try{const r=await run('DELETE FROM catalog_items WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'catalogItem');res.json({message:'Item removido do catálogo.'})}catch{res.status(409).json({error:t(req,'catalogItemInUse')})}})
app.post('/api/catalog/:id/stock',async(req,res)=>{const item=await one('SELECT * FROM catalog_items WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!item)return missing(req,res,'catalogItem');if(!item.track_stock)return res.status(400).json({error:t(req,'catalogItemNoStock')});const {delta,reason}=req.body;if(!Number(delta)||!reason?.trim())return res.status(400).json({error:t(req,'stockAdjustmentRequiredFields')});await run('UPDATE catalog_items SET quantity=quantity+? WHERE id=?', [Number(delta),item.id]);await run('INSERT INTO stock_movements (tenant_id,catalog_item_id,delta,reason) VALUES (?,?,?,?) RETURNING id', [req.tenantId,item.id,Number(delta),reason.trim()]);res.json(await one('SELECT * FROM catalog_items WHERE id=?', [item.id]))})
app.get('/api/suppliers',async(req,res)=>{const q=`%${req.query.search||''}%`;res.json(await many('SELECT * FROM suppliers WHERE tenant_id=? AND (name ILIKE ? OR document ILIKE ?) ORDER BY name', [req.tenantId,q,q]))})
app.post('/api/suppliers',async(req,res)=>{const {name,document=null,phone=null,email=null,notes=null}=req.body;if(!name?.trim())return res.status(400).json({error:t(req,'supplierNameRequired')});const r=await run('INSERT INTO suppliers (tenant_id,name,document,phone,email,notes) VALUES (?,?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),document,phone,email,notes]);res.status(201).json(await one('SELECT * FROM suppliers WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/suppliers/:id',async(req,res)=>{const allowed=['name','document','phone','email','notes','active'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});const supplier=await one('SELECT id FROM suppliers WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!supplier)return missing(req,res,'supplier');await run(`UPDATE suppliers SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>k==='active'?(v?1:0):v),supplier.id]);res.json(await one('SELECT * FROM suppliers WHERE id=?', [supplier.id]))})
app.delete('/api/suppliers/:id',async(req,res)=>{const r=await run('DELETE FROM suppliers WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'supplier');res.json({message:'Fornecedor removido.'})})
app.get('/api/payables',async(req,res)=>{const status=req.query.status;let sql="SELECT p.*,s.name supplier_name,CASE WHEN p.status='pendente' AND p.due_date IS NOT NULL AND p.due_date::date<CURRENT_DATE THEN 'atrasado' ELSE p.status END effective_status FROM payables p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.tenant_id=?";const args=[req.tenantId];if(status)  {sql+=status==='atrasado'?" AND p.status='pendente' AND p.due_date IS NOT NULL AND p.due_date::date<CURRENT_DATE":' AND p.status=?';if(status!=='atrasado')args.push(status)}res.json(await many(`${sql} ORDER BY p.due_date NULLS LAST, p.id DESC`, args))})
app.post('/api/payables',async(req,res)=>{const {supplier_id=null,description,amount,due_date=null}=req.body;if(!description?.trim()||!(Number(amount)>0))return res.status(400).json({error:t(req,'payableRequiredFields')});const r=await run('INSERT INTO payables (tenant_id,supplier_id,description,amount,due_date) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,supplier_id,description.trim(),Number(amount),due_date]);res.status(201).json(await one('SELECT * FROM payables WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/payables/:id',async(req,res)=>{const payable=await one('SELECT * FROM payables WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!payable)return missing(req,res,'payable');const allowed=['supplier_id','description','amount','due_date','status'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});if(req.body.status==='pago'&&payable.status!=='pago'){entries.push(['paid_at',null]);await run(`UPDATE payables SET ${entries.filter(([k])=>k!=='paid_at').map(([k])=>`${k}=?`).join(',')},paid_at=now_text() WHERE id=?`, [...entries.filter(([k])=>k!=='paid_at').map(([,v])=>v),payable.id])}else{await run(`UPDATE payables SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([,v])=>v),payable.id])}res.json(await one('SELECT * FROM payables WHERE id=?', [payable.id]))})
app.delete('/api/payables/:id',async(req,res)=>{const r=await run('DELETE FROM payables WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!r.changes)return missing(req,res,'payable');res.json({message:'Conta removida.'})})

app.get('/api/team',async(req,res)=>res.json(await many("SELECT id,name,email,role,active,created_at FROM users WHERE tenant_id=? ORDER BY id", [req.tenantId])))
app.post('/api/team',requireOwner,async(req,res)=>{const {name,email,password,role='staff'}=req.body;if(!name?.trim()||!email?.trim()||!password||password.length<6)return res.status(400).json({error:t(req,'emailPasswordRequired')});if(!['owner','staff'].includes(role))return res.status(400).json({error:t(req,'noValidFields')});if(await one('SELECT id FROM users WHERE email=?', [email.trim().toLowerCase()]))return res.status(409).json({error:t(req,'emailAlreadyRegistered')});const r=await run('INSERT INTO users (tenant_id,name,email,password_hash,role) VALUES (?,?,?,?,?) RETURNING id', [req.tenantId,name.trim(),email.trim().toLowerCase(),hashPassword(password),role]);await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'team_member_created',entity:'user',entityId:r.lastInsertRowid});res.status(201).json(await one('SELECT id,name,email,role,active,created_at FROM users WHERE id=?', [r.lastInsertRowid]))})
app.patch('/api/team/:id',requireOwner,async(req,res)=>{const member=await one('SELECT * FROM users WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!member)return missing(req,res,'user');const allowed=['active','role'],entries=Object.entries(req.body).filter(([k])=>allowed.includes(k));if(!entries.length)return res.status(400).json({error:t(req,'noValidFields')});if(req.body.role!==undefined&&!['owner','staff'].includes(req.body.role))return res.status(400).json({error:t(req,'noValidFields')});await run(`UPDATE users SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`, [...entries.map(([k,v])=>k==='active'?(v?1:0):v),member.id]);await logAudit({tenantId:req.tenantId,userId:req.user.id,action:'team_member_updated',entity:'user',entityId:member.id,metadata:req.body});res.json(await one('SELECT id,name,email,role,active,created_at FROM users WHERE id=?', [member.id]))})

app.post('/api/vehicles/:id/public-link',async(req,res)=>{const vehicle=await one('SELECT * FROM vehicles WHERE id=? AND tenant_id=?', [req.params.id,req.tenantId]);if(!vehicle)return missing(req,res,'vehicle');const token=await ensureVehicleToken(vehicle);res.json({token,path:`/v/${token}`})})
app.post('/api/orders/:id/approval-link',async(req,res)=>{const order=await one('SELECT * FROM service_orders WHERE (id::text=? OR number=?) AND tenant_id=?', [req.params.id,req.params.id,req.tenantId]);if(!order)return missing(req,res,'order');const token=await ensureOrderApprovalToken(order);res.json({token,path:`/orcamento/${token}`})})
app.patch('/api/workshop/whatsapp-integration',requireOwner,async(req,res)=>{const {whatsapp_phone_id=null,whatsapp_instance=null}=req.body;try{await run('UPDATE tenants SET whatsapp_phone_id=?,whatsapp_instance=? WHERE id=?', [whatsapp_phone_id||null,whatsapp_instance||null,req.tenantId]);res.json({message:t(req,'whatsappIntegrationSaved')})}catch{res.status(409).json({error:t(req,'whatsappIntegrationInUse')})}})

// Webhooks ficam fora do prefixo /api de propósito (callbacks externos do Meta/Evolution, sem token de sessão nosso pra validar).
app.get('/webhooks/meta',(req,res)=>{const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],challenge=req.query['hub.challenge'];if(mode==='subscribe'&&token&&token===process.env.META_WEBHOOK_VERIFY_TOKEN)return res.status(200).send(challenge);res.sendStatus(403)})
// Mapeamento de tenant: primeiro tenta pelo número/instância cadastrado em PATCH /api/workshop/whatsapp-integration; se a oficina não configurou ainda, cai pro cliente encontrado pelo telefone e por último pra oficina 1.
app.post('/webhooks/meta',async(req,res)=>{const entries=req.body?.entry||[];for(const entry of entries){for(const change of entry.changes||[]){const message=change.value?.messages?.[0];if(message){const from=message.from,content=message.text?.body||'[Mensagem não textual]';const phoneNumberId=change.value?.metadata?.phone_number_id;const tenantByNumber=phoneNumberId?await one('SELECT id FROM tenants WHERE whatsapp_phone_id=?', [phoneNumberId]):null;const client=await one(`SELECT id,tenant_id FROM clients WHERE replace(replace(replace(phone,' ',''),'-',''),'(','') LIKE ? LIMIT 1`, [`%${from.slice(-8)}%`]);const tenantId=tenantByNumber?.id||client?.tenant_id||1;await run(`INSERT INTO crm_messages (tenant_id,client_id,channel,direction,recipient,content,status) VALUES (?,?,'whatsapp','entrada',?,?,'recebida') RETURNING id`, [tenantId,client?.id||null,from,content])}}}res.sendStatus(200)})
app.post('/webhooks/evolution',async(req,res)=>{const events=Array.isArray(req.body)?req.body:[req.body];for(const evt of events){if(evt?.event!=='messages.upsert')continue;const data=evt.data;if(!data||data.key?.fromMe)continue;const from=String(data.key?.remoteJid||'').split('@')[0];const content=data.message?.conversation||data.message?.extendedTextMessage?.text||'[Mensagem não textual]';const instance=evt.instance||data.instance||null;const tenantByInstance=instance?await one('SELECT id FROM tenants WHERE whatsapp_instance=?', [instance]):null;const client=await one(`SELECT id,tenant_id FROM clients WHERE replace(replace(replace(phone,' ',''),'-',''),'(','') LIKE ? LIMIT 1`, [`%${from.slice(-8)}%`]);const tenantId=tenantByInstance?.id||client?.tenant_id||1;await run(`INSERT INTO crm_messages (tenant_id,client_id,channel,direction,recipient,content,status) VALUES (?,?,'whatsapp','entrada',?,?,'recebida') RETURNING id`, [tenantId,client?.id||null,from,content])}res.sendStatus(200)})

// Rotas públicas (sem auth): links compartilháveis por WhatsApp/e-mail. Acesso só por token aleatório, nunca por id sequencial.
app.get('/public/vehicles/:token',async(req,res)=>{
  const vehicle=await one('SELECT v.*,c.name client_name FROM vehicles v JOIN clients c ON c.id=v.client_id WHERE v.public_token=?', [req.params.token])
  if(!vehicle)return res.status(404).json({error:t(req,'publicLinkNotFound')})
  const history=await many('SELECT event_type,description,mileage,created_at FROM vehicle_history WHERE vehicle_id=? ORDER BY created_at DESC LIMIT 50', [vehicle.id])
  res.json({vehicle:{brand:vehicle.brand,model:vehicle.model,version:vehicle.version,plate:vehicle.plate,year_model:vehicle.year_model,color:vehicle.color,mileage:vehicle.mileage,client_first_name:(vehicle.client_name||'').split(' ')[0]},history})
})
app.get('/public/orders/:token',async(req,res)=>{
  const order=await one(`${orderSelect} WHERE so.approval_token=?`, [req.params.token])
  if(!order)return res.status(404).json({error:t(req,'publicLinkNotFound')})
  const items=await many('SELECT id,type,description,quantity,unit_price,approved FROM order_items WHERE service_order_id=? ORDER BY id', [order.id])
  const decided=['em_execucao','teste_rodagem','pronto_entrega','entregue','cancelada'].includes(order.status)
  res.json({number:order.number,status:order.status,decided,awaiting:order.status==='aguardando_aprovacao',client_first_name:(order.client_name||'').split(' ')[0],vehicle:`${order.brand} ${order.model}`,plate:order.plate,discount:order.discount,total_amount:order.total_amount,items})
})
app.post('/public/orders/:token/approve',async(req,res)=>{
  const order=await one('SELECT * FROM service_orders WHERE approval_token=?', [req.params.token])
  if(!order)return res.status(404).json({error:t(req,'publicLinkNotFound')})
  if(order.status!=='aguardando_aprovacao')return res.status(409).json({error:t(req,'budgetAlreadyDecided')})
  await run('UPDATE order_items SET approved=1 WHERE service_order_id=? AND approved=0', [order.id])
  await recalculateOrderTotal(order.id)
  await run("UPDATE service_orders SET status='em_execucao',updated_at=now_text() WHERE id=?", [order.id])
  await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [order.tenant_id,order.vehicle_id,order.id,'status','Orçamento aprovado pelo cliente via link público.',order.mileage_in])
  await runAutomations(order.tenant_id,'service_orders','status','em_execucao',order.id)
  await startFlows(order.tenant_id,'service_orders','status','em_execucao',order.id)
  res.json({message:t(req,'budgetApproved')})
})
app.post('/public/orders/:token/reject',async(req,res)=>{
  const order=await one('SELECT * FROM service_orders WHERE approval_token=?', [req.params.token])
  if(!order)return res.status(404).json({error:t(req,'publicLinkNotFound')})
  if(order.status!=='aguardando_aprovacao')return res.status(409).json({error:t(req,'budgetAlreadyDecided')})
  await run("UPDATE service_orders SET status='cancelada',updated_at=now_text() WHERE id=?", [order.id])
  await run('INSERT INTO vehicle_history (tenant_id,vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?,?) RETURNING id', [order.tenant_id,order.vehicle_id,order.id,'status','Orçamento recusado pelo cliente via link público.',order.mileage_in])
  res.json({message:t(req,'budgetRejected')})
})

// Pronto pra receber eventos de um provedor de cobrança real (assinatura paga/falhou). Sem validação de assinatura
// de webhook ainda porque não há provedor real configurado — adicionar verificação de secret quando plugar um.
app.post('/webhooks/billing',async(req,res)=>{await handleWebhookEvent(req.body);res.sendStatus(200)})

app.use((err,req,res,_next)=>{console.error(err);res.status(500).json({error:t(req,'internalError')})});app.listen(port,()=>console.log(`Oficina Pro API em http://localhost:${port}`))
