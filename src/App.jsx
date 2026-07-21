import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from './i18n'
import './App.css'

const API = 'http://localhost:3001'
const TOKEN_KEY = 'oficinapro_token'
const ACTING_TENANT_KEY = 'oficinapro_acting_tenant'
let handleUnauthorized = () => {}
const apiFetch = (path, opts = {}) => {
  const token = localStorage.getItem(TOKEN_KEY)
  const actingTenantId = localStorage.getItem(ACTING_TENANT_KEY)
  const headers = { ...(opts.headers || {}), 'X-Lang': i18n.language }
  if (token) headers.Authorization = `Bearer ${token}`
  if (actingTenantId) headers['X-Tenant-Override'] = actingTenantId
  return fetch(`${API}${path}`, { ...opts, headers }).then(res => {
    if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); handleUnauthorized() }
    return res
  })
}

const statusColor = {
  aberta: 'slate', diagnostico: 'slate', aguardando_aprovacao: 'amber', aguardando_peca: 'purple',
  em_execucao: 'blue', teste_rodagem: 'blue', pronto_entrega: 'green', entregue: 'green', cancelada: 'coral',
}
function statusOf(status, t) { return { label: t(`status.${status}`, { defaultValue: status }), color: statusColor[status] || 'slate' } }

function resizePhoto(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const iconPaths = {
  wrench: 'M14.7 6.3a4 4 0 0 1-5.1 5.1L4 17l-1.5-1.5 5.6-5.6a4 4 0 0 1 5.1-5.1l-2.4 2.4 1.5 1.5 2.4-2.4Z',
  gauge: 'M3 13a7 7 0 1 1 14 0M12 13l3-4M3 13h1m16 0h1M6.5 6.5l.7.7m9.6-.7-.7.7',
  clipboard: 'M8 3h4a1 1 0 0 1 1 1v1H7V4a1 1 0 0 1 1-1ZM5 6h10v11H5V6Zm2.5 4 2 2 3-3.5',
  funnel: 'M3 4h14l-5.5 6.5V15l-3 1.5v-6L3 4Z',
  chat: 'M4 4h12v8H8l-3 3v-3H4V4Z',
  user: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7a5 5 0 0 1 10 0',
  car: 'M4 12v-2l1.5-3.5A2 2 0 0 1 7.4 5h5.2a2 2 0 0 1 1.9 1.5L16 10v2M4 12h12v3H4v-3Zm2 3v1.2M14 15v1.2M6.5 9.5h7',
  calendarIcon: 'M4 5h12v11H4V5Zm0 3h12M7 3v3m6-3v3M7 12h2m2 0h2',
  coin: 'M10 16a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-9v6m-2-1.2c0 .9.9 1.5 2 1.5s2-.5 2-1.4-.9-1.2-2-1.4-2-.5-2-1.4S9 8.7 10 8.7s2 .5 2 1.3',
  users: 'M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6.5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M3 16c0-2.5 2-4 4-4s4 1.5 4 4M12 12.3c1.7.2 3 1.5 3 3.7',
  key: 'M8 12a4 4 0 1 1 3.9-5H17v2h-1.5v2H14v-2h-2.1A4 4 0 0 1 8 12Zm-2-4a2 2 0 1 0 0 4',
  calculatorIcon: 'M6 3h8v14H6V3Zm1.5 3h5M8 9h.01M10 9h.01M12 9h.01M8 11.5h.01M10 11.5h.01M12 11.5h.01M8 14h4',
  gear: 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm7 3-1.6.3a5.4 5.4 0 0 0-.6-1.5l1-1.3-1.4-1.4-1.3 1a5.4 5.4 0 0 0-1.5-.6L11.3 3H8.7l-.3 1.5a5.4 5.4 0 0 0-1.5.6l-1.3-1L4.2 5.5l1 1.3a5.4 5.4 0 0 0-.6 1.5L3 8.7v2.6l1.6.3c.1.5.3 1 .6 1.5l-1 1.3 1.4 1.4 1.3-1c.5.3 1 .5 1.5.6l.3 1.6h2.6l.3-1.6c.5-.1 1-.3 1.5-.6l1.3 1 1.4-1.4-1-1.3c.3-.5.5-1 .6-1.5l1.6-.3V8.7Z',
  chart: 'M4 16V9m4 7V5m4 11v-6m4 6V8',
  garage: 'M3 9 10 3l7 6M4.5 9V16h11V9M8 16v-4h4v4',
}
function Icon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[name] || iconPaths.wrench} /></svg>
}

const currencyLocales = { BRL: 'pt-BR', USD: 'en-US', EUR: 'de-DE' }
let currentCurrency = 'BRL'
let currentDistanceUnit = 'KM'
function money(value) { return value ? Number(value).toLocaleString(currencyLocales[currentCurrency] || 'pt-BR', { style: 'currency', currency: currentCurrency }) : null }
function distance(value) { return value == null ? '' : `${Number(value).toLocaleString(currencyLocales[currentCurrency] || 'pt-BR')} ${currentDistanceUnit}` }
function initials(name = '') { return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '—' }

const languages = [['pt', 'PT'], ['es', 'ES'], ['en', 'EN']]

function Workspace({ user, actingTenant, onLogout, onExitTenant }) {
  const { t } = useTranslation()
  const moneyOr = (v, fallback) => money(v) || fallback
  const [page, setPage] = useState('dashboard')
  const [orders, setOrders] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(undefined)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showLead, setShowLead] = useState(false)
  const [leadPipelineId, setLeadPipelineId] = useState(null)
  const [showClient, setShowClient] = useState(false)
  const [showVehicle, setShowVehicle] = useState(false)
  const [showAutomation, setShowAutomation] = useState(false)
  const [showChecklist, setShowChecklist] = useState(null)
  const [showPayment, setShowPayment] = useState(false)
  const [checkinInitial, setCheckinInitial] = useState(null)
  const [showEmployees, setShowEmployees] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [showCalculator, setShowCalculator] = useState(false)
  const [crmVersion, setCrmVersion] = useState(0)
  const [vehiclesVersion, setVehiclesVersion] = useState(0)
  const [toast, setToast] = useState('')
  const [tab, setTab] = useState('summary')

  const notify = (message) => { setToast(message); setTimeout(() => setToast(''), 2600) }

  const selectOrder = useCallback(async (order) => {
    if (!order) return setSelected(null)
    const detail = await apiFetch(`/api/orders/${order.id}`).then(r => r.ok ? r.json() : null).catch(() => null)
    setSelected(detail)
  }, [])

  useEffect(() => { apiFetch(`/api/orders?search=${encodeURIComponent(query)}`).then(r => r.json()).then(setOrders).catch(() => {}) }, [query])
  useEffect(() => { if (orders.length && selected === undefined) selectOrder(orders[0]) }, [orders, selected, selectOrder])

  const [mechanics, setMechanics] = useState([])
  useEffect(() => { apiFetch('/api/employees?active=1').then(r => r.json()).then(setMechanics).catch(() => {}) }, [])
  const [stations, setStations] = useState([])
  const loadStations = useCallback(() => apiFetch('/api/work-stations').then(r => r.json()).then(setStations).catch(() => {}), [])
  useEffect(() => { loadStations() }, [loadStations])
  const assignWorkStation = async (workStationId) => {
    const res = await apiFetch(`/api/orders/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ work_station_id: workStationId || null }) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('orderDetail.cannotAssignStation'))
    setSelected(prev => prev && prev.id === data.id ? { ...prev, ...data } : prev)
    setOrders(prev => prev.map(o => o.id === data.id ? { ...o, ...data } : o))
    loadStations()
  }
  const assignMechanic = async (mechanicId) => {
    const res = await apiFetch(`/api/orders/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mechanic_id: mechanicId || null }) })
    if (!res.ok) return notify(t('orderDetail.cannotAssignMechanic'))
    const updated = await res.json()
    setSelected(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev)
    setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))
  }

  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const loadNotifications = useCallback(() => apiFetch('/api/notifications/pending').then(r => r.json()).then(setNotifications).catch(() => {}), [])
  useEffect(() => { loadNotifications() }, [loadNotifications])
  const [lowStock, setLowStock] = useState([])
  const loadLowStock = useCallback(() => apiFetch('/api/catalog?low_stock=1').then(r => r.json()).then(setLowStock).catch(() => {}), [])
  useEffect(() => { loadLowStock() }, [loadLowStock])

  const updateStatus = async (orderId, status) => {
    const res = await apiFetch(`/api/orders/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    if (!res.ok) return notify(t('orderDetail.cannotUpdateStatus'))
    const updated = await res.json()
    setSelected(prev => prev && prev.id === updated.id ? { ...prev, ...updated } : prev)
    setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o))
    notify(t('orderDetail.statusUpdated'))
  }
  const emitInvoice = async (orderId) => {
    const res = await apiFetch(`/api/orders/${orderId}/invoice`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('orderDetail.cannotIssueInvoice'))
    notify(t('orderDetail.invoiceIssued', { number: data.number, amount: money(data.total_amount) }))
  }
  const sendBudget = async (order) => {
    if (!order.client_phone) return notify(t('orderDetail.noClientPhone'))
    const linkRes = await apiFetch(`/api/orders/${order.id}/approval-link`, { method: 'POST' })
    const { path } = linkRes.ok ? await linkRes.json() : { path: '' }
    const content = t('orderDetail.budgetMessage', { client: order.client_name, order: order.number, vehicle: `${order.brand} ${order.model}`, amount: money(order.total_amount) }) + (path ? ` ${window.location.origin}${path}` : '')
    const res = await apiFetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: order.client_id, channel: 'whatsapp', recipient: order.client_phone, content }) })
    if (!res.ok) return notify(t('orderDetail.cannotSendBudget'))
    notify(t('orderDetail.budgetSent'))
  }
  const copyApprovalLink = async (order) => {
    const res = await apiFetch(`/api/orders/${order.id}/approval-link`, { method: 'POST' })
    if (!res.ok) return notify(t('orderDetail.cannotSendBudget'))
    const { path } = await res.json()
    await navigator.clipboard.writeText(`${window.location.origin}${path}`).catch(() => {})
    notify(t('common.linkCopied'))
  }

  const nav = [['dashboard', t('nav.dashboard'), <Icon name="gauge" />], ['orders', t('nav.orders'), <Icon name="clipboard" />], ['crm', t('nav.crm'), <Icon name="funnel" />], ['messages', t('nav.messages'), <Icon name="chat" />], ['clients', t('nav.clients'), <Icon name="user" />], ['vehicles', t('nav.vehicles'), <Icon name="car" />], ['catalog', t('nav.catalog'), <Icon name="wrench" />], ['stations', t('nav.stations'), <Icon name="garage" />], ['agenda', t('nav.agenda'), <Icon name="calendarIcon" />], ['financial', t('nav.financial'), <Icon name="coin" />]]
  const workshopName = actingTenant?.name || user.tenant_name || t('sidebar.workshopName')
  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div>
      <div className="workshop"><small>{t('sidebar.workshopLabel')}</small><strong>{workshopName}</strong></div>
      <nav>{nav.map(([key, label, icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}><i>{icon}</i>{label}</button>)}</nav>
      <div className="sidebar-bottom"><button onClick={() => setShowEmployees(true)}><i><Icon name="users" /></i>{t('sidebar.team')}</button><button onClick={() => setShowTeam(true)}><i><Icon name="key" /></i>{t('sidebar.logins')}</button><button onClick={() => setShowCalculator(true)}><i><Icon name="calculatorIcon" /></i>{t('sidebar.calculator')}</button><button onClick={() => setShowAutomation(true)}><i><Icon name="gear" /></i>{t('sidebar.automations')}</button><button className="profile" onClick={() => setShowSettings(true)}><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><small>{t(`employeeRole.${user.role}`, { defaultValue: user.role })}</small></div><span>⋮</span></button></div>
    </aside>
    <nav className="mobile-nav">{nav.map(([key, label, icon]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)} title={label}><i>{icon}</i></button>)}</nav>

    <section className="workspace">
      <header className="topbar"><div className="mobile-brand">{t('appName')}<span>{t('appNamePro')}</span></div><label className="global-search">⌕<input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search.placeholder')} /></label><div className="top-actions">{actingTenant && <div className="admin-banner"><span>{t('admin.viewingAs', { workshop: workshopName })}</span><button type="button" className="text-btn" onClick={onExitTenant}>{t('admin.exit')}</button></div>}<div className="quick-add-wrap"><button type="button" className="icon-btn quick-add-btn" onClick={() => setShowQuickAdd(v => !v)}>＋</button>{showQuickAdd && <div className="notif-dropdown quick-add-menu"><button type="button" onClick={() => { setShowCheckin(true); setShowQuickAdd(false) }}><Icon name="clipboard" size={15} /> {t('dashboard.newOrder')}</button><button type="button" onClick={() => { setShowClient(true); setShowQuickAdd(false) }}><Icon name="user" size={15} /> {t('clients.newClient')}</button><button type="button" onClick={() => { setLeadPipelineId(null); setShowLead(true); setShowQuickAdd(false) }}><Icon name="funnel" size={15} /> {t('crm.newLead')}</button></div>}</div><div className="notif-wrap"><button className="icon-btn" onClick={() => { setShowNotifications(v => !v); loadNotifications(); loadLowStock() }}>♧{(notifications.length + lowStock.length) > 0 && <b>{notifications.length + lowStock.length}</b>}</button>{showNotifications && <div className="notif-dropdown"><div className="notif-dropdown-head">{t('notifications.title')}</div>{notifications.map(n => <div className="notif-item" key={`r-${n.id}`}><strong>{t(`reminderType.${n.type}`, { defaultValue: n.type })}</strong><span>{n.client_name} · {n.plate}</span></div>)}{lowStock.map(i => <div className="notif-item" key={`s-${i.id}`}><strong>{t('notifications.lowStock')}</strong><span>{i.name} · {i.quantity}/{i.min_quantity}</span></div>)}{!notifications.length && !lowStock.length && <p className="empty-hint">{t('notifications.empty')}</p>}</div>}</div><div className="avatar small">{initials(user.name)}</div></div></header>
      <div className="content">
        {page === 'dashboard' ? <Dashboard orders={orders} onSelect={selectOrder} onNew={() => setShowCheckin(true)} notify={notify} /> : page === 'crm' ? <CrmPage key={crmVersion} onNew={(pipelineId) => { setLeadPipelineId(pipelineId); setShowLead(true) }} notify={notify} onLeadConverted={(client) => { setCheckinInitial({ client: client.name, phone: client.phone || '' }); setShowCheckin(true) }} /> : page === 'messages' ? <ChatPage notify={notify} /> : page === 'clients' ? <ClientsPage onNew={() => setShowClient(true)} /> : page === 'financial' ? <FinanceiroPage notify={notify} /> : page === 'vehicles' ? <VehiclesPage key={vehiclesVersion} onNew={() => setShowVehicle(true)} /> : page === 'catalog' ? <CatalogPage notify={notify} /> : page === 'stations' ? <WorkStationsPage notify={notify} /> : page === 'agenda' ? <AgendaPage notify={notify} /> : <OrdersPage orders={orders} onSelect={selectOrder} onNew={() => setShowCheckin(true)} />}
      </div>
    </section>

    <aside className={`detail-panel${selected ? ' open' : ''}`}>
      {!selected ? <div className="detail-empty"><p>{t('orderDetail.selectHint')}</p></div> : <>
      <div className="detail-head"><div><span className="eyebrow">{t('orderDetail.title')}</span><h2>{selected.number}</h2></div><button className="icon-btn" onClick={() => setSelected(null)}>×</button></div>
      <div className="vehicle-card"><div className="car-icon">▱</div><div><strong>{selected.brand} {selected.model}{selected.version ? ` ${selected.version}` : ''}</strong><span>{selected.plate} · {distance(selected.vehicle_mileage ?? selected.mileage_in ?? 0)}</span></div><span className={`status ${statusOf(selected.status, t).color}`}>{statusOf(selected.status, t).label}</span></div>
      <div className="client-line"><div className="avatar coral">{initials(selected.client_name)}</div><div><strong>{selected.client_name}</strong><span>{selected.client_phone || t('orderDetail.noPhone')}</span></div><button>›</button></div>
      <div className="tabs">{[['summary', t('orderDetail.tabSummary')], ['history', t('orderDetail.tabHistory')], ['checklist', t('orderDetail.tabChecklist')]].map(([key, label]) => <button key={key} className={tab === key ? 'chosen' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
      {tab === 'summary' ? <>
        <div className="detail-section"><h3>{t('orderDetail.complaint')}</h3><p>{selected.customer_complaint || t('orderDetail.noComplaint')}</p></div>
        <div className="detail-section"><h3>{t('orderDetail.itemsTitle')} <span className="count">{selected.items?.length || 0}</span></h3>
          {(selected.items || []).map(item => <div className="line-item" key={item.id}><span>{item.description}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span><b>{moneyOr(item.total, '—')}</b></div>)}
          {!selected.items?.length && <p className="empty-hint">{t('orderDetail.noItems')}</p>}
          <div className="total"><span>{t('orderDetail.totalExpected')}</span><strong>{moneyOr(selected.total_amount, '—')}</strong></div>
        </div>
        <div className="detail-section"><h3>{t('orderDetail.responsible')}</h3><div className="mechanic"><div className="avatar green">{initials(selected.mechanic_name || '')}</div><div><strong>{selected.mechanic_name || t('orderDetail.notAssigned')}</strong><span>{t('orderDetail.mechanicRole')}</span></div></div><select className="mechanic-select" value={selected.mechanic_id || ''} onChange={e => assignMechanic(e.target.value ? Number(e.target.value) : null)}><option value="">{t('orderDetail.noAssignment')}</option>{mechanics.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#536276', marginTop: 10 }}>{t('orderDetail.workStation')}</label>
          <select className="mechanic-select" value={selected.work_station_id || ''} onChange={e => assignWorkStation(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('orderDetail.noStation')}</option>
            {stations.filter(s => !s.occupying_order_id || s.occupying_order_id === selected.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="detail-section"><h3>{t('orderDetail.payment')}</h3><div className="line-item"><span>{t('orderDetail.paymentStatus')}</span><b className={selected.payment_status === 'pago' ? 'paid-tag' : ''}>{selected.payment_status === 'pago' ? t('orderDetail.paid') : selected.payment_status === 'parcial' ? t('orderDetail.partial') : t('orderDetail.pending')}</b></div>{selected.paid_amount > 0 && <><div className="line-item"><span>{t('orderDetail.paidAmount')}</span><b>{moneyOr(selected.paid_amount, '—')}</b></div><div className="line-item"><span>{t('orderDetail.paymentForm')}</span><b>{t(`paymentMethod.${selected.payment_method}`, { defaultValue: selected.payment_method || '—' })}</b></div></>}<button type="button" className="secondary" style={{ marginTop: 10 }} onClick={() => setShowPayment(true)}>{selected.paid_amount > 0 ? t('orderDetail.editPayment') : t('orderDetail.registerPayment')}</button></div>
      </> : tab === 'history' ? <div className="timeline">
        {(selected.history || []).map(event => <div className="timeline-item" key={event.id}><span className="dot"></span><small>{new Date(event.created_at).toLocaleString('pt-BR')}</small><strong>{event.event_type}</strong><p>{event.description}</p>{event.mileage ? <em>{distance(event.mileage)}</em> : null}</div>)}
        {!selected.history?.length && <p className="empty-hint">{t('orderDetail.noHistory')}</p>}
      </div> : <div className="detail-section">
        <h3>{t('orderDetail.entryChecklist')}</h3>
        {selected.checklists?.find(c => c.type === 'entrada') ? <ChecklistSummary checklist={selected.checklists.find(c => c.type === 'entrada')} /> : <p className="empty-hint">{t('orderDetail.noEntryChecklist')}</p>}
        <h3 style={{ marginTop: 18 }}>{t('orderDetail.exitChecklist')}</h3>
        {selected.checklists?.find(c => c.type === 'saida') ? <ChecklistSummary checklist={selected.checklists.find(c => c.type === 'saida')} /> : <p className="empty-hint">{t('orderDetail.noExitChecklist')}</p>}
        <button type="button" className="secondary" style={{ marginTop: 14 }} onClick={() => setShowChecklist('saida')}>{selected.checklists?.find(c => c.type === 'saida') ? t('orderDetail.editExitChecklist') : t('orderDetail.fillExitChecklist')}</button>
      </div>}
      <div className="detail-footer"><button className="secondary" onClick={() => sendBudget(selected)}>{t('orderDetail.sendBudget')}</button><button className="secondary" onClick={() => copyApprovalLink(selected)}>{t('orderDetail.copyApprovalLink')}</button><button className="secondary" onClick={() => emitInvoice(selected.id)}>{t('orderDetail.issueInvoice')}</button><button className="primary" onClick={() => updateStatus(selected.id, 'entregue')}>{t('orderDetail.completeOrder')}</button></div>
      </>}
    </aside>
    {showCheckin && <CheckinModal initial={checkinInitial} onClose={() => { setShowCheckin(false); setCheckinInitial(null) }} onSave={async form => {
      const res = await apiFetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: form.client, client_phone: form.phone || null, plate: form.plate, brand: form.brand, model: form.model, mileage: Number(String(form.km).replace(/\D/g, '')) || 0, complaint: form.issue || null, fuel_level: form.fuel_level || null, checklist_items: form.checklist_items }) })
      const data = await res.json()
      if (!res.ok) return notify(data.error || t('checkin.cannotCreate'))
      setOrders(prev => [data, ...prev])
      await selectOrder(data)
      setShowCheckin(false)
      setCheckinInitial(null)
      notify(t('checkin.created'))
    }} />}
    {showLead && <LeadModal onClose={() => setShowLead(false)} onSave={async form => { await apiFetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, phone: form.phone, vehicle_interest: form.vehicle_interest, source: form.source || 'manual', pipeline_id: leadPipelineId }) }); setCrmVersion(v => v + 1); setShowLead(false); notify(t('crm.leadCreated')) }} />}
    {showClient && <ClientModal onClose={() => setShowClient(false)} onSave={async form => { await apiFetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, document: form.document, phone: form.phone, email: form.email }) }); setShowClient(false); notify(t('clients.created')) }} />}
    {showVehicle && <VehicleModal onClose={() => setShowVehicle(false)} onSave={async payload => { const res = await apiFetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await res.json(); if (!res.ok) return notify(data.error || t('vehicles.cannotSave')); setVehiclesVersion(v => v + 1); setShowVehicle(false); notify(t('vehicles.created')) }} />}
    {showAutomation && <FlowBuilderModal onClose={() => setShowAutomation(false)} notify={notify} />}
    {showChecklist && selected && <ChecklistModal order={selected} type={showChecklist} existing={selected.checklists?.find(c => c.type === showChecklist)} onClose={() => setShowChecklist(null)} onSaved={() => { setShowChecklist(null); selectOrder(selected) }} notify={notify} />}
    {showPayment && selected && <PaymentModal order={selected} onSaved={() => { setShowPayment(false); selectOrder(selected) }} notify={notify} />}
    {showEmployees && <EmployeeModal onClose={() => { setShowEmployees(false); apiFetch('/api/employees?active=1').then(r => r.json()).then(setMechanics).catch(() => {}) }} notify={notify} />}
    {showTeam && <TeamModal onClose={() => setShowTeam(false)} notify={notify} user={user} />}
    {showCalculator && <LaborCalculatorModal onClose={() => setShowCalculator(false)} />}
    {showSettings && <SettingsModal onClose={() => setShowSettings(false)} user={user} onLogout={onLogout} />}
    {toast && <div className="toast">✓ {toast}</div>}
  </main>
}

function daysUntil(dateStr) { if (!dateStr) return null; return Math.ceil((new Date(dateStr) - new Date()) / 86400000) }

function Dashboard({ orders, onSelect, onNew, notify }) {
  const { t } = useTranslation()
  const [data, setData] = useState({ metrics: {}, reminders: [], recent_activity: [] })
  const loadDashboard = () => apiFetch('/api/dashboard').then(r => r.json()).then(setData).catch(() => {})
  useEffect(() => { loadDashboard() }, [])
  const m = data.metrics || {}
  const sendReminder = async (id) => { await apiFetch(`/api/reminders/${id}/send`, { method: 'PATCH' }); notify(t('dashboard.reminderSent')); loadDashboard() }
  const today = new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()
  return <>
  <div className="page-heading"><div><span className="eyebrow">{today}</span><h1>{t('dashboard.greeting')} <span>👋</span></h1><p>{t('dashboard.subtitle')}</p></div><button className="primary new-os" onClick={onNew}>＋ {t('dashboard.newOrder')}</button></div>
  <div className="metrics"><Metric icon="◫" label={t('dashboard.openOrders')} value={String(m.open_orders ?? 0)} tone="blue" /><Metric icon="◉" label={t('dashboard.awaitingApproval')} value={String(m.awaiting_approval ?? 0)} tone="amber" /><Metric icon="◷" label={t('dashboard.inProgress')} value={String(m.in_progress ?? 0)} tone="purple" /><Metric icon="↗" label={t('dashboard.revenuePaid')} value={money(m.revenue) || t('dashboard.toDefine')} tone="green" /></div>
  <div className="dashboard-grid"><section className="panel orders-panel"><div className="panel-header"><div><h2>{t('dashboard.ordersTitle')}</h2><p>{t('dashboard.ordersSubtitle')}</p></div>{orders[0] && <button className="text-btn" onClick={() => onSelect(orders[0])}>{t('dashboard.viewAll')}</button>}</div><div className="table"><div className="tr table-head"><span>{t('dashboard.orderVehicleCol')}</span><span>{t('dashboard.clientCol')}</span><span>{t('dashboard.statusCol')}</span><span>{t('dashboard.deliveryCol')}</span><span></span></div>{orders.map(o => { const meta = statusOf(o.status, t); return <button className="tr order-row" key={o.id} onClick={() => onSelect(o)}><div><strong>{o.number}</strong><span>{o.brand} {o.model} · <b>{o.plate}</b></span></div><span>{o.client_name}</span><span><i className={`status ${meta.color}`}>{meta.label}</i></span><span>{o.estimated_delivery_at ? new Date(o.estimated_delivery_at).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('dashboard.toDefine')}</span><span>›</span></button> })}{!orders.length && <p className="empty-hint">{t('dashboard.noOrders')}</p>}</div></section>
  <section className="panel activity"><div className="panel-header"><div><h2>{t('dashboard.activityTitle')}</h2><p>{t('dashboard.activitySubtitle')}</p></div></div>
    {(data.recent_activity || []).map(a => <Activity key={a.id} when={new Date(a.created_at).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} who={a.client_name} text={`— ${a.description}`} initials={initials(a.client_name)} color="blue" />)}
    {!data.recent_activity?.length && <p className="empty-hint">{t('dashboard.noActivity')}</p>}
  </section></div>
  <section className="bottom-grid"><section className="panel reminders"><div className="panel-header"><div><h2>{t('dashboard.remindersTitle')}</h2><p>{t('dashboard.remindersSubtitle')}</p></div></div>{(data.reminders || []).map(r => { const d = r.due_date ? new Date(r.due_date) : null; const diff = daysUntil(r.due_date); return <div className="reminder" key={r.id}><div className="calendar"><b>{d ? d.getDate() : '–'}</b><small>{d ? d.toLocaleDateString(i18n.language, { month: 'short' }).toUpperCase().replace('.', '') : ''}</small></div><div><strong>{t(`reminderType.${r.type}`, { defaultValue: r.type })}</strong><p>{r.brand} {r.model} · <b>{r.plate}</b> · {r.client_name}</p></div><span>{diff === null ? '—' : diff <= 0 ? t('dashboard.overdue') : t('dashboard.inDays', { count: diff })}</span><button onClick={() => sendReminder(r.id)}>{t('dashboard.send')}</button></div> })}{!data.reminders?.length && <p className="empty-hint">{t('dashboard.noReminders')}</p>}</section><section className="panel goal"><span className="eyebrow">{t('dashboard.monthRevenue')}</span><h2>{money(m.revenue) || t('dashboard.toDefine')}</h2><p>{t('dashboard.monthRevenueHint')}</p></section></section>
  </> }

function OrdersPage({ orders, onSelect, onNew }) {
  const { t } = useTranslation()
  const [statusFilter, setStatusFilter] = useState(null)
  const filters = [[null, t('orders.filterAll')], ['aberta', t('orders.filterOpen')], ['em_execucao', t('orders.filterInProgress')], ['aguardando_aprovacao', t('orders.filterAwaitingApproval')], ['entregue', t('orders.filterDone')]]
  const visible = statusFilter ? orders.filter(o => o.status === statusFilter) : orders
  return <><div className="page-heading"><div><span className="eyebrow">{t('orders.operationalTitle')}</span><h1>{t('orders.title')}</h1><p>{t('orders.resultsFound', { count: visible.length })}</p></div><button className="primary new-os" onClick={onNew}>＋ {t('dashboard.newOrder')}</button></div><section className="panel all-orders"><div className="filters">{filters.map(([key, label]) => <button key={label} className={statusFilter === key ? 'filter-active' : ''} onClick={() => setStatusFilter(key)}>{label}</button>)}</div><div className="table"><div className="tr table-head"><span>{t('dashboard.orderVehicleCol')}</span><span>{t('dashboard.clientCol')}</span><span>{t('dashboard.statusCol')}</span><span>{t('dashboard.deliveryCol')}</span><span></span></div>{visible.map(o => { const meta = statusOf(o.status, t); return <button className="tr order-row" key={o.id} onClick={() => onSelect(o)}><div><strong>{o.number}</strong><span>{o.brand} {o.model} · <b>{o.plate}</b></span></div><span>{o.client_name}</span><span><i className={`status ${meta.color}`}>{meta.label}</i></span><span>{o.estimated_delivery_at ? new Date(o.estimated_delivery_at).toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('dashboard.toDefine')}</span><span>›</span></button> })}{!visible.length && <p className="empty-hint">{t('orders.noOrders')}</p>}</div></section></> }
function Metric({ icon, label, value, hint, tone }) { return <article className="metric"><div className={`metric-icon ${tone}`}>{icon}</div><div><p>{label}</p><h2>{value}</h2>{hint && <small className={tone === 'green' ? 'green-text' : ''}>{hint}</small>}</div></article> }
function Activity({ when, who, text, initials, color }) { return <div className="activity-row"><div className={`avatar ${color}`}>{initials}</div><div><p><b>{who}</b> {text}</p><small>{when}</small></div></div> }

function CheckinModal({ onClose, onSave, initial }) {
  const { t } = useTranslation()
  const fuelLevelKeys = ['', 'reserva', '1/4', '1/2', '3/4', 'cheio']
  const entryChecklistTemplate = t('checklist.entryTemplate', { returnObjects: true })
  const [form, setForm] = useState({ client: initial?.client || '', phone: initial?.phone || '', plate: '', brand: '', model: '', km: '', issue: '', fuel_level: '' })
  const [checklist, setChecklist] = useState(entryChecklistTemplate.map(label => ({ label, checked: false })))
  const [knownVehicle, setKnownVehicle] = useState(null)
  const [plateChecked, setPlateChecked] = useState(false)
  const change = e => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (e.target.name === 'plate') { setKnownVehicle(null); setPlateChecked(false) }
  }
  const toggle = (i) => setChecklist(items => items.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
  const setChecklistPhoto = (i, photo) => setChecklist(items => items.map((it, idx) => idx === i ? { ...it, photo } : it))
  const onChecklistPhotoChange = async (i, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setChecklistPhoto(i, await resizePhoto(file))
  }
  const lookupPlate = async () => {
    const normalized = form.plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!normalized) return
    const rows = await apiFetch(`/api/vehicles?search=${normalized}`).then(r => r.json()).catch(() => [])
    const match = rows.find(v => v.plate === normalized)
    if (match) {
      setKnownVehicle(match)
      setForm(f => ({ ...f, client: match.client_name, phone: match.client_phone || f.phone, brand: match.brand, model: match.model, km: String(match.mileage) }))
    } else setKnownVehicle(null)
    setPlateChecked(true)
  }
  return <div className="modal-backdrop"><form className="modal checkin-modal" onSubmit={e => { e.preventDefault(); onSave({ ...form, checklist_items: checklist }) }}>
    <div className="modal-head"><div><span className="eyebrow">{t('checkin.quickTitle')}</span><h2>{t('checkin.title')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('checkin.intro')}</p>
    {knownVehicle ? <p className="field-hint plate-match">{t('checkin.plateMatch', { client: knownVehicle.client_name })}</p>
      : plateChecked ? <p className="field-hint plate-new">{t('checkin.plateNew')}</p> : null}
    <div className="form-grid">
      <label>{t('checkin.plate')}<input required name="plate" value={form.plate} onChange={change} onBlur={lookupPlate} placeholder="ABC1D23" /></label>
      <label>{t('checkin.client')}<input required name="client" value={form.client} onChange={change} placeholder={t('checkin.clientPlaceholder')} /></label>
      <label>{t('checkin.phone')}<input name="phone" value={form.phone} onChange={change} placeholder="(11) 99999-9999" /></label>
      <label>{t('checkin.brand')}<input name="brand" value={form.brand} onChange={change} placeholder={t('checkin.brandPlaceholder')} /></label>
      <label>{t('checkin.model')}<input name="model" value={form.model} onChange={change} placeholder={t('checkin.modelPlaceholder')} /></label>
      <label>{t('checkin.mileage')}<input required name="km" value={form.km} onChange={change} placeholder="Ex.: 45200" /></label>
      <label>{t('checkin.fuelLevel')}<select name="fuel_level" value={form.fuel_level} onChange={change}>{fuelLevelKeys.map(k => <option key={k} value={k}>{t(`fuelLevel.${k}`)}</option>)}</select></label>
    </div>
    <label>{t('checkin.complaint')}<textarea name="issue" value={form.issue} onChange={change} placeholder={t('checkin.complaintPlaceholder')} /></label>
    <h3 className="section-title">{t('checkin.entryChecklist')}</h3>
    <div className="checklist-grid">{checklist.map((item, i) => <div className="checklist-item-row" key={item.label}>
      <label className="checklist-item"><input type="checkbox" checked={item.checked} onChange={() => toggle(i)} />{item.label}</label>
      {item.photo
        ? <div className="checklist-photo"><img src={item.photo} alt="" /><button type="button" onClick={() => setChecklistPhoto(i, null)}>×</button></div>
        : <label className="checklist-photo-add" title={t('checklist.addPhoto')}>📷<input type="file" accept="image/*" capture="environment" hidden onChange={e => onChecklistPhotoChange(i, e)} /></label>}
    </div>)}</div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{t('checkin.submit')}</button></div>
  </form></div>
}

function ChecklistSummary({ checklist }) {
  const { t } = useTranslation()
  return <ul className="checklist-summary">{checklist.items.map(item => <li key={item.label} className={item.checked ? 'done' : ''}>{item.checked ? '✓' : '○'} {item.label}{item.photo && <img className="checklist-summary-photo" src={item.photo} alt="" onClick={() => window.open(item.photo, '_blank')} />}</li>)}{checklist.fuel_level && <li>⛽ {t('orderDetail.fuelSummary')}: {checklist.fuel_level}</li>}{checklist.notes && <li>📝 {checklist.notes}</li>}</ul>
}

function ChecklistModal({ order, type, existing, onClose, onSaved, notify }) {
  const { t } = useTranslation()
  const fuelLevelKeys = ['', 'reserva', '1/4', '1/2', '3/4', 'cheio']
  const template = t(type === 'entrada' ? 'checklist.entryTemplate' : 'checklist.exitTemplate', { returnObjects: true })
  const [items, setItems] = useState(() => template.map(label => { const found = existing?.items?.find(i => i.label === label); return { label, checked: found?.checked || false, photo: found?.photo || null } }))
  const [fuelLevel, setFuelLevel] = useState(existing?.fuel_level || '')
  const [mileage, setMileage] = useState(existing?.mileage || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const toggle = (i) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
  const setPhoto = (i, photo) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, photo } : it))
  const onPhotoChange = async (i, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhoto(i, await resizePhoto(file))
  }
  const save = async (e) => {
    e.preventDefault()
    const res = await apiFetch(`/api/orders/${order.id}/checklist`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, items, fuel_level: fuelLevel || null, mileage: mileage ? Number(mileage) : null, notes: notes || null }) })
    if (!res.ok) return notify(t('checklist.cannotSave'))
    notify(t('checklist.saved'))
    onSaved()
  }
  return <div className="modal-backdrop"><form className="modal checkin-modal" onSubmit={save}>
    <div className="modal-head"><div><span className="eyebrow">{t('checklist.title')}</span><h2>{type === 'entrada' ? t('checklist.entryTitle') : t('checklist.exitTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <div className="checklist-grid">{items.map((item, i) => <div className="checklist-item-row" key={item.label}>
      <label className="checklist-item"><input type="checkbox" checked={item.checked} onChange={() => toggle(i)} />{item.label}</label>
      {item.photo
        ? <div className="checklist-photo"><img src={item.photo} alt="" /><button type="button" onClick={() => setPhoto(i, null)}>×</button></div>
        : <label className="checklist-photo-add" title={t('checklist.addPhoto')}>📷<input type="file" accept="image/*" capture="environment" hidden onChange={e => onPhotoChange(i, e)} /></label>}
    </div>)}</div>
    <div className="form-grid">
      <label>{t('checkin.fuelLevel')}<select value={fuelLevel} onChange={e => setFuelLevel(e.target.value)}>{fuelLevelKeys.map(k => <option key={k} value={k}>{t(`fuelLevel.${k}`)}</option>)}</select></label>
      <label>{t('checkin.mileage')}<input value={mileage} onChange={e => setMileage(e.target.value)} placeholder={t('checklist.mileagePlaceholder')} /></label>
    </div>
    <label>{t('common.notes')}<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('checklist.notesPlaceholder')} /></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{t('checklist.submit')}</button></div>
  </form></div>
}

const paymentMethodKeys = ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto']

function PaymentModal({ order, onSaved, notify }) {
  const { t } = useTranslation()
  const [payments, setPayments] = useState(order.payments || [])
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
  const remaining = Math.max(0, (order.total_amount || 0) - totalPaid)
  const [amount, setAmount] = useState(remaining || order.total_amount || 0)
  const [method, setMethod] = useState(paymentMethodKeys[0])
  const [installments, setInstallments] = useState(1)

  const addPayment = async (e) => {
    e.preventDefault()
    const res = await apiFetch(`/api/orders/${order.id}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, amount: Number(amount), installments: method === 'cartao_credito' ? Number(installments) : 1 }) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('payment.cannotAddPayment'))
    setPayments(data.payments)
    setAmount(Math.max(0, (order.total_amount || 0) - data.paid_amount))
    notify(t('payment.paymentAdded'))
  }
  const removePayment = async (id) => {
    const res = await apiFetch(`/api/orders/${order.id}/payments/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) return
    setPayments(data.payments)
    setAmount(Math.max(0, (order.total_amount || 0) - data.paid_amount))
    notify(t('payment.paymentRemoved'))
  }

  return <div className="modal-backdrop"><form className="modal" onSubmit={addPayment}>
    <div className="modal-head"><div><span className="eyebrow">{t('payment.title')}</span><h2>{t('payment.registerTitle')}</h2></div><button type="button" onClick={onSaved}>×</button></div>
    <p className="modal-intro">{t('payment.orderTotal', { number: order.number, amount: money(order.total_amount) || '—' })}</p>
    <div className="detail-section payment-entries">
      {payments.map(p => <div className="line-item" key={p.id}><span>{t(`paymentMethod.${p.method}`)}{p.method === 'cartao_credito' && p.installments > 1 ? ` · ${t('payment.installmentsN', { count: p.installments })}` : ''}</span><b>{money(p.amount)} <button type="button" className="text-btn danger" onClick={() => removePayment(p.id)}>{t('payment.removePayment')}</button></b></div>)}
      {!payments.length && <p className="empty-hint">{t('payment.noPayments')}</p>}
      <div className="total"><span>{t('payment.remaining')}</span><strong>{remaining > 0 ? money(remaining) : t('payment.remainingPaid')}</strong></div>
    </div>
    {remaining > 0 && <div className="form-grid">
      <label>{t('payment.amount')}<input required type="number" step="0.01" min="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label>{t('payment.method')}<select value={method} onChange={e => setMethod(e.target.value)}>{paymentMethodKeys.map(k => <option key={k} value={k}>{t(`paymentMethod.${k}`)}</option>)}</select></label>
      {method === 'cartao_credito' && <label>{t('payment.installments')}<select value={installments} onChange={e => setInstallments(e.target.value)}>{Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{t('payment.installmentsN', { count: n })}</option>)}</select></label>}
    </div>}
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={onSaved}>{t('common.close')}</button>
      {remaining > 0 && <button className="primary">{t('payment.addPayment')}</button>}
    </div>
  </form></div>
}

const leadStageColors = { novo: 'slate', contato_feito: 'blue', orcamento: 'amber', negociacao: 'purple', ganho: 'green', perdido: 'coral' }
const kanbanPalette = ['blue', 'amber', 'purple', 'green', 'coral', 'slate']
const stageColorOf = (key, index) => leadStageColors[key] || kanbanPalette[index % kanbanPalette.length]

function CrmPage({ onNew, notify, onLeadConverted }) {
  const { t } = useTranslation()
  const [pipelines, setPipelines] = useState([])
  const [pipelineId, setPipelineId] = useState(null)
  const [leads, setLeads] = useState([])
  const [showPipelineModal, setShowPipelineModal] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOverKey, setDragOverKey] = useState(null)
  const [editingLead, setEditingLead] = useState(null)

  const loadPipelines = () => apiFetch('/api/pipelines').then(r => r.json()).then(rows => { setPipelines(rows); setPipelineId(prev => prev && rows.some(p => p.id === prev) ? prev : rows[0]?.id ?? null) }).catch(() => {})
  useEffect(() => { loadPipelines() }, [])
  useEffect(() => { if (!pipelineId) return; apiFetch(`/api/leads?pipeline_id=${pipelineId}`).then(r => r.ok ? r.json() : []).then(rows => setLeads(rows.filter(r => !r.converted_client_id))).catch(() => {}) }, [pipelineId])

  const pipeline = pipelines.find(p => p.id === pipelineId)
  const stages = pipeline?.stages || []

  const move = async (lead, stageKey) => {
    const response = await apiFetch(`/api/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: stageKey }) })
    if (!response.ok) return
    if (stageKey === 'ganho') { await apiFetch(`/api/leads/${lead.id}/convert`, { method: 'POST' }); notify(t('crm.convertedToClient', { name: lead.name })); onLeadConverted?.(lead) }
    setLeads(items => items.map(item => item.id === lead.id ? { ...item, stage: stageKey } : item))
  }

  const createPipeline = async ({ name, stages: stageLabels }) => {
    const res = await apiFetch('/api/pipelines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, stages: stageLabels }) })
    if (!res.ok) return
    const created = await res.json()
    await loadPipelines()
    setPipelineId(created.id)
    setShowPipelineModal(false)
    notify(t('crm.pipelineCreated', { name }))
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('crm.relationshipTitle')}</span><h1>{t('crm.title')}</h1><p>{t('crm.subtitle')}</p></div><button className="primary new-os" onClick={() => onNew(pipelineId)}>＋ {t('crm.newLead')}</button></div>
    <div className="pipeline-tabs">{pipelines.map(p => <button key={p.id} className={p.id === pipelineId ? 'active' : ''} onClick={() => setPipelineId(p.id)}>{p.name}</button>)}<button className="pipeline-add" onClick={() => setShowPipelineModal(true)}>{t('crm.newPipeline')}</button></div>
    <div className="crm-metrics"><div><strong>{leads.length}</strong><span>{t('crm.activeLeads')}</span></div><div><strong>{money(leads.reduce((sum, lead) => sum + Number(lead.estimated_value || 0), 0)) || '—'}</strong><span>{t('crm.inOpportunities')}</span></div><div><strong>38%</strong><span>{t('crm.conversionRate')}</span></div><div><strong>5</strong><span>{t('crm.returnsToday')}</span></div></div>
    <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(180px,1fr))` }}>
      {stages.map((stage, stageIndex) => <section
        className={`kanban-column ${stageColorOf(stage.key, stageIndex)}${dragOverKey === stage.key ? ' drag-over' : ''}`}
        key={stage.key}
        onDragOver={e => e.preventDefault()}
        onDragEnter={() => setDragOverKey(stage.key)}
        onDragLeave={() => setDragOverKey(prev => prev === stage.key ? null : prev)}
        onDrop={e => { e.preventDefault(); setDragOverKey(null); const id = Number(e.dataTransfer.getData('text/plain')); const lead = leads.find(l => l.id === id); if (lead && lead.stage !== stage.key) move(lead, stage.key) }}
      >
        <div className="kanban-title"><span>{stage.label}</span><b>{leads.filter(l => l.stage === stage.key).length}</b></div>
        {leads.filter(l => l.stage === stage.key).map(lead => <article
          className={`lead-card ${stageColorOf(stage.key, stageIndex)}`}
          key={lead.id}
          draggable
          onDragStart={e => { setDragId(lead.id); e.dataTransfer.setData('text/plain', String(lead.id)) }}
          onDragEnd={() => setDragId(null)}
          onClick={() => setEditingLead(lead)}
          style={{ opacity: dragId === lead.id ? 0.4 : 1 }}
        >
          <div className="lead-card-head"><div className="avatar coral">{lead.name.split(' ').map(n => n[0]).join('').slice(0, 2)}</div><button type="button" onClick={e => { e.stopPropagation(); setEditingLead(lead) }}>•••</button></div>
          <strong>{lead.name}</strong><span>{lead.vehicle_interest || t('crm.vehicleNotInformed')}</span><small>◉ {lead.phone || t('common.noPhone')}</small>
          <div className="lead-card-foot" onClick={e => e.stopPropagation()}><b>{money(lead.estimated_value) || '—'}</b><select value={lead.stage} onChange={e => move(lead, e.target.value)}>{stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        </article>)}
        <button className="add-lead" onClick={() => onNew(pipelineId)}>{t('crm.addLead')}</button>
      </section>)}
    </div>
    {showPipelineModal && <PipelineModal onClose={() => setShowPipelineModal(false)} onSave={createPipeline} />}
    {editingLead && <LeadEditModal
      lead={editingLead}
      stages={stages}
      onClose={() => setEditingLead(null)}
      onSave={async updates => {
        const res = await apiFetch(`/api/leads/${editingLead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
        if (!res.ok) return
        const updated = await res.json()
        if (updates.stage === 'ganho' && editingLead.stage !== 'ganho') { await apiFetch(`/api/leads/${editingLead.id}/convert`, { method: 'POST' }); notify(t('crm.convertedToClient', { name: updated.name })); onLeadConverted?.(updated) } else { notify(t('crm.leadUpdated')) }
        setLeads(items => items.map(item => item.id === updated.id ? { ...item, ...updated } : item))
        setEditingLead(null)
      }}
    />}
  </>
}
function LeadEditModal({ lead, stages, onClose, onSave }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ name: lead.name || '', phone: lead.phone || '', email: lead.email || '', vehicle_interest: lead.vehicle_interest || '', estimated_value: lead.estimated_value || 0, source: lead.source || '', notes: lead.notes || '', stage: lead.stage })
  const change = e => setForm({ ...form, [e.target.name]: e.target.value })
  const submit = e => { e.preventDefault(); onSave({ ...form, estimated_value: Number(form.estimated_value) || 0 }) }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">{t('appName')}{t('appNamePro')}</span><h2>{t('crm.editLeadTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('crm.editLeadIntro')}</p>
    <div className="form-grid">
      <label>{t('crm.fullName')}<input required name="name" value={form.name} onChange={change} /></label>
      <label>{t('checkin.phone')}<input name="phone" value={form.phone} onChange={change} /></label>
      <label>{t('crm.email')}<input name="email" value={form.email} onChange={change} /></label>
      <label>{t('crm.vehicleInterest')}<input name="vehicle_interest" value={form.vehicle_interest} onChange={change} /></label>
      <label>{t('crm.estimatedValue')}<input name="estimated_value" value={form.estimated_value} onChange={change} /></label>
      <label>{t('crm.source')}<input name="source" value={form.source} onChange={change} /></label>
      <label>{t('crm.stage')}<select name="stage" value={form.stage} onChange={change}>{stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
    </div>
    <label>{t('common.notes')}<textarea name="notes" value={form.notes} onChange={change} placeholder={t('common.notesPlaceholder')} /></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{t('crm.saveChanges')}</button></div>
  </form></div>
}
function PipelineModal({ onClose, onSave }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [stages, setStages] = useState('')
  return <div className="modal-backdrop"><form className="modal" onSubmit={e => { e.preventDefault(); onSave({ name, stages: stages.split(',').map(s => s.trim()).filter(Boolean) }) }}>
    <div className="modal-head"><div><span className="eyebrow">{t('appName')}{t('appNamePro')}</span><h2>{t('crm.newPipelineTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('crm.newPipelineIntro')}</p>
    <label>{t('crm.pipelineName')}<input required value={name} onChange={e => setName(e.target.value)} placeholder={t('crm.pipelineNamePlaceholder')} /></label>
    <label>{t('crm.pipelineStages')}<input required value={stages} onChange={e => setStages(e.target.value)} placeholder={t('crm.pipelineStagesPlaceholder')} /></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{t('crm.createPipeline')}</button></div>
  </form></div>
}
function ClientsPage({ onNew }) {
  const { t } = useTranslation()
  const [clients, setClients] = useState([])
  const [query, setQuery] = useState('')
  const [openClientId, setOpenClientId] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)
  const load = useCallback(() => apiFetch(`/api/clients?search=${encodeURIComponent(query)}`).then(r => r.json()).then(setClients).catch(() => {}), [query])
  useEffect(() => { load() }, [load])

  const exportCsv = async () => {
    const res = await apiFetch('/api/clients/export')
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'clientes.csv'; a.click()
    URL.revokeObjectURL(url)
  }
  const importCsv = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    const csv = await file.text()
    const res = await apiFetch('/api/clients/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const data = await res.json().catch(() => ({}))
    setImporting(false)
    if (!res.ok) return alert(data.error || t('clients.importError'))
    alert(t('clients.importSummary', { imported: data.imported, skipped: data.skipped }))
    load()
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('clients.relationshipTitle')}</span><h1>{t('clients.title')}</h1><p>{t('clients.subtitle')}</p></div>
      <div className="page-heading-actions">
        <button type="button" className="secondary" onClick={exportCsv}>{t('clients.export')}</button>
        <button type="button" className="secondary" disabled={importing} onClick={() => fileInputRef.current?.click()}>{importing ? t('clients.importing') : t('clients.import')}</button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={importCsv} />
        <button className="primary new-os" onClick={onNew}>＋ {t('clients.newClient')}</button>
      </div>
    </div>
    <div className="filters"><input className="vehicle-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('clients.searchPlaceholder')} /></div>
    <section className="panel client-list">
      <div className="client-list-header"><span>{t('clients.clientCol')}</span><span>{t('clients.documentCol')}</span><span>{t('clients.phoneCol')}</span><span>{t('clients.statusCol')}</span></div>
      {clients.map(c => <button className="client-record client-record-btn" key={c.id} onClick={() => setOpenClientId(c.id)}>
        <div><div className="avatar blue">{initials(c.name)}</div><div><strong>{c.name}</strong><small>{c.email || t('common.noEmail')}</small></div></div>
        <span>{c.document || '—'}</span><span>{c.phone || '—'}</span><i>{c.whatsapp_opt_in ? t('clients.active') : t('clients.noOptIn')}</i>
      </button>)}
      {!clients.length && <p className="empty-hint">{t('clients.noClients')}</p>}
    </section>
    {openClientId && <ClientDetailModal clientId={openClientId} onClose={() => setOpenClientId(null)} />}
  </>
}

function ClientDetailModal({ clientId, onClose }) {
  const { t } = useTranslation()
  const [client, setClient] = useState(null)
  const [openVehicleId, setOpenVehicleId] = useState(null)
  useEffect(() => { apiFetch(`/api/clients/${clientId}`).then(r => r.json()).then(setClient).catch(() => {}) }, [clientId])
  if (!client) return null
  return <div className="modal-backdrop"><div className="modal vehicle-modal">
    <div className="modal-head"><div><span className="eyebrow">{t('clients.detailTitle')}</span><h2>{client.name}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{client.document || t('common.noDocument')} · {client.phone || t('common.noPhone')} · {client.email || t('common.noEmail')}</p>
    <h3 className="section-title">{t('clients.vehiclesTitle', { count: client.vehicles?.length || 0 })}</h3>
    <div className="vehicle-list">
      {(client.vehicles || []).map(v => <div key={v.id}>
        <button type="button" className="vehicle-row" onClick={() => setOpenVehicleId(prev => prev === v.id ? null : v.id)}>
          <span><b>{v.plate}</b> · {v.brand} {v.model}{v.year_model ? ` · ${v.year_model}` : ''}</span>
          <span>{distance(v.mileage)}</span>
          <span>{openVehicleId === v.id ? '▲' : '▼'}</span>
        </button>
        {openVehicleId === v.id && <VehicleHistoryPanel vehicleId={v.id} embedded />}
      </div>)}
      {!client.vehicles?.length && <p className="empty-hint">{t('clients.noVehicles')}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button></div>
  </div></div>
}

const reminderTypeKeys = ['troca_oleo', 'revisao', 'alinhamento', 'filtro_ar', 'pneus', 'bateria', 'freios', 'suspensao', 'outro']

function VehicleHistoryPanel({ vehicleId, embedded }) {
  const { t } = useTranslation()
  const [vehicle, setVehicle] = useState(null)
  const [clients, setClients] = useState([])
  const [transferTo, setTransferTo] = useState('')
  const [reminderType, setReminderType] = useState(reminderTypeKeys[0])
  const [reminderDays, setReminderDays] = useState('')
  const [reminderKm, setReminderKm] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const load = useCallback(() => apiFetch(`/api/vehicles/${vehicleId}`).then(r => r.json()).then(setVehicle).catch(() => {}), [vehicleId])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (!embedded) return; apiFetch('/api/clients').then(r => r.json()).then(setClients).catch(() => {}) }, [embedded])

  const createReminder = async (e) => {
    e.preventDefault()
    if (!vehicle || (!reminderDays && !reminderKm)) return
    await apiFetch('/api/reminders/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: vehicle.client_id, vehicle_id: vehicle.id, type: reminderType, current_mileage: vehicle.mileage, interval_days: reminderDays || null, interval_mileage: reminderKm || null }) })
    setReminderDays(''); setReminderKm('')
    load()
  }
  const transferOwner = async () => {
    if (!transferTo) return
    const res = await apiFetch(`/api/vehicles/${vehicleId}/owner`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: Number(transferTo) }) })
    if (res.ok) { setTransferTo(''); load() }
  }
  const copyPublicLink = async () => {
    const res = await apiFetch(`/api/vehicles/${vehicleId}/public-link`, { method: 'POST' })
    if (!res.ok) return
    const { path } = await res.json()
    await navigator.clipboard.writeText(`${window.location.origin}${path}`).catch(() => {})
    setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2200)
  }

  if (!vehicle) return <p className="empty-hint">{t('common.loading')}</p>
  return <div className="vehicle-history-panel">
    <div className="detail-section">
      <h3>{t('vehicles.publicHistory')}</h3>
      <p>{t('vehicles.publicHistoryIntro')}</p>
      <button type="button" className="text-btn" onClick={copyPublicLink}>{linkCopied ? t('common.linkCopied') : t('vehicles.copyPublicLink')}</button>
    </div>
    <div className="detail-section">
      <h3>{t('vehicles.whatToDo')} <span className="count">{vehicle.reminders?.length || 0}</span></h3>
      {(vehicle.reminders || []).map(r => <div className="line-item" key={r.id}><span>{t(`reminderType.${r.type}`, { defaultValue: r.type })}{r.due_date ? ` · ${t('common.until')} ${new Date(r.due_date).toLocaleDateString('pt-BR')}` : ''}{r.due_mileage ? ` · ${distance(r.due_mileage)}` : ''}</span></div>)}
      {!vehicle.reminders?.length && <p className="empty-hint">{t('vehicles.noPendingReminders')}</p>}
      <form className="reminder-form" onSubmit={createReminder}>
        <select value={reminderType} onChange={e => setReminderType(e.target.value)}>{reminderTypeKeys.map(k => <option key={k} value={k}>{t(`reminderType.${k}`)}</option>)}</select>
        <input value={reminderDays} onChange={e => setReminderDays(e.target.value.replace(/\D/g, ''))} placeholder={t('vehicles.reminderDays')} />
        <input value={reminderKm} onChange={e => setReminderKm(e.target.value.replace(/\D/g, ''))} placeholder={t('vehicles.reminderKm')} />
        <button type="submit" className="text-btn">{t('vehicles.createReminder')}</button>
      </form>
    </div>
    <div className="detail-section">
      <h3>{t('vehicles.whatWasDone')} <span className="count">{vehicle.history?.length || 0}</span></h3>
      <div className="timeline">
        {(vehicle.history || []).map(event => <div className="timeline-item" key={event.id}><span className="dot"></span><small>{new Date(event.created_at).toLocaleString('pt-BR')}</small><strong>{event.event_type}</strong><p>{event.description}</p>{event.mileage ? <em>{distance(event.mileage)}</em> : null}</div>)}
        {!vehicle.history?.length && <p className="empty-hint">{t('vehicles.noHistory')}</p>}
      </div>
    </div>
    <div className="detail-section">
      <h3>{t('vehicles.owners')} <span className="count">{vehicle.owners?.length || 0}</span></h3>
      {(vehicle.owners || []).map(o => <div className="line-item" key={o.id}><span>{o.client_name}</span><b>{o.ended_at ? `${t('common.until')} ${new Date(o.ended_at).toLocaleDateString('pt-BR')}` : t('common.current')}</b></div>)}
      {embedded && <div className="transfer-owner"><select value={transferTo} onChange={e => setTransferTo(e.target.value)}><option value="">{t('vehicles.transferTo')}</option>{clients.filter(c => c.id !== vehicle.client_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className="text-btn" onClick={transferOwner}>{t('vehicles.transfer')}</button></div>}
    </div>
  </div>
}
function LeadModal({ onClose, onSave }) {
  const { t } = useTranslation()
  return <FormModal title={t('crm.leadFormTitle')} intro={t('crm.leadFormIntro')} onClose={onClose} onSave={onSave} fields={[['name', t('crm.fullName'), t('crm.leadNamePlaceholder')], ['phone', t('checkin.phone'), '(11) 99999-9999'], ['vehicle_interest', t('crm.vehicleInterest'), t('crm.vehicleInterestPlaceholder')], ['source', t('crm.source'), t('crm.originPlaceholder')]]} action={t('crm.addToPipeline')} />
}
function ClientModal({ onClose, onSave }) {
  const { t } = useTranslation()
  return <FormModal title={t('clients.formTitle')} intro={t('clients.formIntro')} onClose={onClose} onSave={onSave} fields={[['name', t('crm.fullName'), t('checkin.clientPlaceholder')], ['document', t('clients.document'), t('clients.documentPlaceholder')], ['phone', t('checkin.phone'), '(11) 99999-9999'], ['email', t('crm.email'), t('clients.emailPlaceholder')]]} action={t('clients.save')} />
}
function FormModal({ title, intro, onClose, onSave, fields, action }) {
  const { t } = useTranslation()
  const [values, setValues] = useState({})
  return <div className="modal-backdrop"><form className="modal" onSubmit={async e => { e.preventDefault(); await onSave(values) }}><div className="modal-head"><div><span className="eyebrow">{t('appName')}{t('appNamePro')}</span><h2>{title}</h2></div><button type="button" onClick={onClose}>×</button></div><p className="modal-intro">{intro}</p><div className="form-grid">{fields.map(([key, label, placeholder], i) => <label key={key}>{label}<input required={i === 0} value={values[key] || ''} onChange={e => setValues({ ...values, [key]: e.target.value })} placeholder={placeholder} /></label>)}</div><label>{t('common.notes')}<textarea placeholder={t('common.notesPlaceholder')} /></label><div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary">{action} →</button></div></form></div>
}

function InvoicesTab({ notify }) {
  const { t } = useTranslation()
  const [invoices, setInvoices] = useState([])
  const load = () => apiFetch('/api/invoices').then(r => r.json()).then(setInvoices).catch(() => {})
  useEffect(() => { load() }, [])
  const cancel = async (id) => { const res = await apiFetch(`/api/invoices/${id}/cancel`, { method: 'PATCH' }); if (res.ok) { notify(t('financial.canceled')); load() } }
  const total = invoices.filter(i => i.status === 'emitida').reduce((sum, i) => sum + i.total_amount, 0)
  const cols = '1fr 1fr 1.2fr 1.3fr 1fr .9fr'
  return <>
    <div className="crm-metrics"><div><strong>{invoices.length}</strong><span>{t('financial.issuedInvoices')}</span></div><div><strong>{money(total) || '—'}</strong><span>{t('financial.totalInvoiced')}</span></div></div>
    <section className="panel client-list">
      <div className="client-list-header" style={{ gridTemplateColumns: cols }}><span>{t('financial.numberCol')}</span><span>{t('financial.orderCol')}</span><span>{t('financial.clientCol')}</span><span>{t('financial.laborPartsCol')}</span><span>{t('financial.totalCol')}</span><span>{t('financial.statusCol')}</span></div>
      {invoices.map(inv => <div className="client-record" key={inv.id} style={{ gridTemplateColumns: cols }}>
        <span>{inv.number}</span><span>{inv.order_number}</span><span>{inv.client_name}</span><span>{money(inv.labor_amount) || '—'} / {money(inv.parts_amount) || '—'}</span><span>{money(inv.total_amount) || '—'}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><i className={inv.status === 'emitida' ? '' : 'invoice-canceled'}>{inv.status}</i>{inv.status === 'emitida' && <button className="text-btn" onClick={() => cancel(inv.id)}>{t('financial.cancel')}</button>}</span>
      </div>)}
      {!invoices.length && <p className="empty-hint">{t('financial.noInvoices')}</p>}
    </section>
  </>
}

function SuppliersTab({ notify }) {
  const { t } = useTranslation()
  const [suppliers, setSuppliers] = useState([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const load = () => apiFetch('/api/suppliers').then(r => r.json()).then(setSuppliers).catch(() => {})
  useEffect(() => { load() }, [])
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    await apiFetch('/api/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone: phone || null }) })
    setName(''); setPhone(''); load(); notify(t('suppliers.created'))
  }
  const toggleActive = async (supplier) => { await apiFetch(`/api/suppliers/${supplier.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !supplier.active }) }); load() }
  return <>
    <form className="inline-form" onSubmit={create}>
      <input required value={name} onChange={e => setName(e.target.value)} placeholder={t('suppliers.namePlaceholder')} />
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
      <button className="primary">{t('suppliers.add')}</button>
    </form>
    <section className="panel client-list">
      {suppliers.map(s => <div className="client-record" key={s.id} style={{ gridTemplateColumns: '1.5fr 1fr .6fr' }}>
        <span><b>{s.name}</b></span><span>{s.phone || '—'}</span>
        <button type="button" className="text-btn" onClick={() => toggleActive(s)}>{s.active ? t('common.deactivate') : t('common.activate')}</button>
      </div>)}
      {!suppliers.length && <p className="empty-hint">{t('suppliers.empty')}</p>}
    </section>
  </>
}

function PayablesTab({ notify }) {
  const { t } = useTranslation()
  const [payables, setPayables] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState({ supplier_id: '', description: '', amount: '', due_date: '' })
  const load = () => apiFetch('/api/payables').then(r => r.json()).then(setPayables).catch(() => {})
  useEffect(() => { load(); apiFetch('/api/suppliers').then(r => r.json()).then(setSuppliers).catch(() => {}) }, [])
  const create = async (e) => {
    e.preventDefault()
    if (!form.description.trim() || !(Number(form.amount) > 0)) return
    await apiFetch('/api/payables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplier_id: form.supplier_id || null, description: form.description, amount: Number(form.amount), due_date: form.due_date || null }) })
    setForm({ supplier_id: '', description: '', amount: '', due_date: '' }); load(); notify(t('payables.created'))
  }
  const markPaid = async (p) => { await apiFetch(`/api/payables/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'pago' }) }); load() }
  const remove = async (p) => { await apiFetch(`/api/payables/${p.id}`, { method: 'DELETE' }); load() }
  const openTotal = payables.filter(p => p.effective_status !== 'pago').reduce((sum, p) => sum + Number(p.amount), 0)
  return <>
    <div className="crm-metrics"><div><strong>{money(openTotal) || '—'}</strong><span>{t('payables.openTotal')}</span></div></div>
    <form className="inline-form" onSubmit={create}>
      <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}><option value="">{t('payables.noSupplier')}</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('payables.descriptionPlaceholder')} />
      <input required type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder={t('payables.amountPlaceholder')} />
      <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
      <button className="primary">{t('payables.add')}</button>
    </form>
    <section className="panel client-list">
      {payables.map(p => <div className="client-record" key={p.id} style={{ gridTemplateColumns: '1.6fr 1fr .8fr .8fr 1fr' }}>
        <span><b>{p.description}</b>{p.supplier_name ? <small style={{ display: 'block', color: 'var(--muted)' }}>{p.supplier_name}</small> : null}</span>
        <span>{money(p.amount)}</span>
        <span>{p.due_date ? new Date(p.due_date).toLocaleDateString('pt-BR') : '—'}</span>
        <span className={`status ${p.effective_status === 'pago' ? 'green' : p.effective_status === 'atrasado' ? 'coral' : 'amber'}`}>{t(`payables.status_${p.effective_status}`)}</span>
        <span style={{ display: 'flex', gap: 8 }}>{p.effective_status !== 'pago' && <button type="button" className="text-btn" onClick={() => markPaid(p)}>{t('payables.markPaid')}</button>}<button type="button" className="text-btn danger" onClick={() => remove(p)}>{t('common.remove')}</button></span>
      </div>)}
      {!payables.length && <p className="empty-hint">{t('payables.empty')}</p>}
    </section>
  </>
}

function ReportsTab() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  useEffect(() => { apiFetch('/api/reports/cashflow?months=6').then(r => r.json()).then(setData).catch(() => {}) }, [])
  if (!data) return <p className="empty-hint">{t('common.loading')}</p>
  const maxAbs = Math.max(1, ...data.series.map(m => Math.max(m.revenue, m.expenses)))
  return <>
    <div className="crm-metrics">
      <div><strong>{money(data.totals.revenue) || '—'}</strong><span>{t('reports.revenue6m')}</span></div>
      <div><strong>{money(data.totals.expenses) || '—'}</strong><span>{t('reports.expenses6m')}</span></div>
      <div><strong className={data.totals.balance >= 0 ? 'green-text' : ''}>{money(data.totals.balance) || '—'}</strong><span>{t('reports.balance6m')}</span></div>
      <div><strong>{money(data.totals.open_payables) || '—'}</strong><span>{t('reports.openPayables')}</span></div>
    </div>
    <section className="panel" style={{ padding: 20 }}>
      <h3 style={{ font: "700 13px 'Plus Jakarta Sans'", margin: '0 0 16px' }}>{t('reports.monthlyTitle')}</h3>
      {data.series.map(m => <div key={m.month} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          <span>{m.month}</span><span>{t('reports.revenue')} {money(m.revenue) || 'R$ 0'} · {t('reports.expenses')} {money(m.expenses) || 'R$ 0'}</span>
        </div>
        <div className="progress" style={{ marginBottom: 3 }}><i style={{ width: `${(m.revenue / maxAbs) * 100}%`, background: 'var(--success)' }}></i></div>
        <div className="progress"><i style={{ width: `${(m.expenses / maxAbs) * 100}%`, background: 'var(--danger)' }}></i></div>
      </div>)}
    </section>
  </>
}

function FinanceiroPage({ notify }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('invoices')
  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('financial.title')}</span><h1>{t('financial.heading')}</h1><p>{t('financial.subtitle')}</p></div></div>
    <div className="pipeline-tabs">
      <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}>{t('financial.tabInvoices')}</button>
      <button className={tab === 'suppliers' ? 'active' : ''} onClick={() => setTab('suppliers')}>{t('financial.tabSuppliers')}</button>
      <button className={tab === 'payables' ? 'active' : ''} onClick={() => setTab('payables')}>{t('financial.tabPayables')}</button>
      <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>{t('financial.tabReports')}</button>
    </div>
    {tab === 'invoices' ? <InvoicesTab notify={notify} /> : tab === 'suppliers' ? <SuppliersTab notify={notify} /> : tab === 'payables' ? <PayablesTab notify={notify} /> : <ReportsTab />}
  </>
}

function CatalogModal({ item, onClose, onSaved, notify }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ type: item?.type || 'peca', name: item?.name || '', sku: item?.sku || '', unit_price: item?.unit_price || '', cost_price: item?.cost_price || '', track_stock: item?.track_stock ?? false, quantity: item?.quantity ?? 0, min_quantity: item?.min_quantity ?? 0 })
  const submit = async (e) => {
    e.preventDefault()
    const payload = { ...form, unit_price: Number(form.unit_price) || 0, cost_price: Number(form.cost_price) || 0, quantity: Number(form.quantity) || 0, min_quantity: Number(form.min_quantity) || 0 }
    const res = item ? await apiFetch(`/api/catalog/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) : await apiFetch('/api/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('catalog.cannotSave'))
    onSaved()
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">{t('catalog.title')}</span><h2>{item ? t('catalog.editItem') : t('catalog.newItem')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <div className="form-grid">
      <label>{t('catalog.type')}<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="peca">{t('catalog.type_peca')}</option><option value="servico">{t('catalog.type_servico')}</option></select></label>
      <label>{t('catalog.name')}<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      {form.type === 'peca' && <label>{t('catalog.sku')}<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} /></label>}
      <label>{t('catalog.unitPrice')}<input type="number" step="0.01" value={form.unit_price} onChange={e => setForm({ ...form, unit_price: e.target.value })} /></label>
      <label>{t('catalog.costPrice')}<input type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} /></label>
      {form.type === 'peca' && <>
        <label className="checkbox-label"><input type="checkbox" checked={form.track_stock} onChange={e => setForm({ ...form, track_stock: e.target.checked })} /> {t('catalog.trackStock')}</label>
        {form.track_stock && <>
          <label>{t('catalog.quantity')}<input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
          <label>{t('catalog.minQuantity')}<input type="number" value={form.min_quantity} onChange={e => setForm({ ...form, min_quantity: e.target.value })} /></label>
        </>}
      </>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button><button className="primary">{t('common.save')}</button></div>
  </form></div>
}

function CatalogPage({ notify }) {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const load = useCallback(() => { const params = new URLSearchParams({ search: query }); if (typeFilter) params.set('type', typeFilter); if (lowStockOnly) params.set('low_stock', '1'); apiFetch(`/api/catalog?${params}`).then(r => r.json()).then(setItems).catch(() => {}) }, [query, typeFilter, lowStockOnly])
  useEffect(() => { load() }, [load])
  const adjustStock = async (item) => {
    const deltaRaw = window.prompt(t('catalog.adjustPrompt', { name: item.name }))
    if (!deltaRaw) return
    const delta = Number(deltaRaw)
    if (!delta) return
    const reason = window.prompt(t('catalog.adjustReasonPrompt')) || t('catalog.manualAdjustment')
    await apiFetch(`/api/catalog/${item.id}/stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delta, reason }) })
    load()
  }
  const remove = async (item) => {
    const res = await apiFetch(`/api/catalog/${item.id}`, { method: 'DELETE' })
    if (!res.ok) { const data = await res.json(); return notify(data.error || t('catalog.cannotSave')) }
    load()
  }
  const cols = '.5fr 1.6fr 1fr 1fr .8fr .8fr'
  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('catalog.eyebrow')}</span><h1>{t('catalog.heading')}</h1><p>{t('catalog.subtitle')}</p></div><button className="primary new-os" onClick={() => setShowNew(true)}>＋ {t('catalog.newItem')}</button></div>
    <div className="filters">
      <input className="vehicle-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('catalog.searchPlaceholder')} />
      <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">{t('catalog.allTypes')}</option><option value="peca">{t('catalog.type_peca')}</option><option value="servico">{t('catalog.type_servico')}</option></select>
      <label className="checkbox-label"><input type="checkbox" checked={lowStockOnly} onChange={e => setLowStockOnly(e.target.checked)} /> {t('catalog.lowStockOnly')}</label>
    </div>
    <section className="panel client-list">
      <div className="client-list-header" style={{ gridTemplateColumns: cols }}><span>{t('catalog.typeCol')}</span><span>{t('catalog.nameCol')}</span><span>{t('catalog.priceCol')}</span><span>{t('catalog.stockCol')}</span><span></span><span></span></div>
      {items.map(item => <div className="client-record" key={item.id} style={{ gridTemplateColumns: cols }}>
        <span>{t(`catalog.type_${item.type}`)}</span>
        <span><b>{item.name}</b>{item.sku ? <small style={{ display: 'block', color: 'var(--muted)' }}>{item.sku}</small> : null}</span>
        <span>{money(item.unit_price)}</span>
        <span>{item.track_stock ? <span className={Number(item.quantity) <= Number(item.min_quantity) ? 'status coral' : ''}>{item.quantity}</span> : '—'}</span>
        <span>{item.track_stock && <button type="button" className="text-btn" onClick={() => adjustStock(item)}>{t('catalog.adjustStock')}</button>}</span>
        <span style={{ display: 'flex', gap: 8 }}><button type="button" className="text-btn" onClick={() => setEditing(item)}>{t('common.edit')}</button><button type="button" className="text-btn danger" onClick={() => remove(item)}>{t('common.remove')}</button></span>
      </div>)}
      {!items.length && <p className="empty-hint">{t('catalog.empty')}</p>}
    </section>
    {showNew && <CatalogModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} notify={notify} />}
    {editing && <CatalogModal item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} notify={notify} />}
  </>
}

const workStationTypeKeys = ['box', 'elevador', 'patio']

function WorkStationsPage({ notify }) {
  const { t } = useTranslation()
  const [stations, setStations] = useState([])
  const [name, setName] = useState('')
  const [type, setType] = useState(workStationTypeKeys[0])
  const load = useCallback(() => apiFetch('/api/work-stations').then(r => r.json()).then(setStations).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const res = await apiFetch('/api/work-stations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type }) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('workStations.cannotSave'))
    setName(''); load(); notify(t('workStations.created'))
  }
  const remove = async (station) => { await apiFetch(`/api/work-stations/${station.id}`, { method: 'DELETE' }); load() }
  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('workStations.eyebrow')}</span><h1>{t('workStations.heading')}</h1><p>{t('workStations.subtitle')}</p></div></div>
    <form className="inline-form" onSubmit={create}>
      <input required value={name} onChange={e => setName(e.target.value)} placeholder={t('workStations.namePlaceholder')} />
      <select value={type} onChange={e => setType(e.target.value)}>{workStationTypeKeys.map(k => <option key={k} value={k}>{t(`workStations.type_${k}`)}</option>)}</select>
      <button className="primary">{t('workStations.add')}</button>
    </form>
    <div className="crm-metrics">
      {stations.map(s => <div key={s.id} className={s.occupying_order_id ? '' : ''}>
        <strong className={s.occupying_order_id ? 'coral' : 'green-text'} style={{ display: 'block' }}>{s.occupying_order_id ? t('workStations.occupied') : t('workStations.free')}</strong>
        <span>{s.name} · {t(`workStations.type_${s.type}`)}</span>
        {s.occupying_order_id && <span style={{ display: 'block', marginTop: 4 }}>{s.occupying_order_number} · {s.occupying_plate} · {s.occupying_client_name}</span>}
        {!s.occupying_order_id && <button type="button" className="text-btn" onClick={() => remove(s)}>{t('common.remove')}</button>}
      </div>)}
      {!stations.length && <p className="empty-hint">{t('workStations.empty')}</p>}
    </div>
  </>
}

function VehiclesPage({ onNew }) {
  const { t } = useTranslation()
  const [vehicles, setVehicles] = useState([])
  const [query, setQuery] = useState('')
  const [openVehicleId, setOpenVehicleId] = useState(null)
  useEffect(() => { apiFetch(`/api/vehicles?search=${encodeURIComponent(query)}`).then(r => r.json()).then(setVehicles).catch(() => {}) }, [query])
  const cols = '1fr 1.7fr .7fr 1fr'
  return <>
    <div className="page-heading"><div><span className="eyebrow">{t('vehicles.fleetTitle')}</span><h1>{t('vehicles.title')}</h1><p>{t('vehicles.countRegistered', { count: vehicles.length })}</p></div><button className="primary new-os" onClick={onNew}>＋ {t('vehicles.newVehicle')}</button></div>
    <div className="filters"><input className="vehicle-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('vehicles.searchPlaceholder')} /></div>
    <section className="panel client-list">
      <div className="client-list-header" style={{ gridTemplateColumns: cols }}><span>{t('vehicles.plateCol')}</span><span>{t('vehicles.vehicleCol')}</span><span>{t('vehicles.kmCol')}</span><span>{t('vehicles.clientCol')}</span></div>
      {vehicles.map(v => <button className="client-record client-record-btn" key={v.id} style={{ gridTemplateColumns: cols }} onClick={() => setOpenVehicleId(v.id)}>
        <span><b>{v.plate}</b></span><span>{v.brand} {v.model}{v.year_model ? ` · ${v.year_model}` : ''}</span><span>{Number(v.mileage).toLocaleString('pt-BR')}</span><span>{v.client_name}</span>
      </button>)}
      {!vehicles.length && <p className="empty-hint">{t('vehicles.noVehicles')}</p>}
    </section>
    {openVehicleId && <div className="modal-backdrop"><div className="modal vehicle-modal">
      <div className="modal-head"><div><span className="eyebrow">{t('vehicles.formTitle')}</span><h2>{t('vehicles.historyTitle')}</h2></div><button type="button" onClick={() => setOpenVehicleId(null)}>×</button></div>
      <VehicleHistoryPanel vehicleId={openVehicleId} embedded />
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpenVehicleId(null)}>{t('common.close')}</button></div>
    </div></div>}
  </>
}

const FIPE_BASE = 'https://parallelum.com.br/fipe/api/v1/carros'

function VehicleModal({ onClose, onSave }) {
  const { t } = useTranslation()
  const isUS = currentCurrency === 'USD'
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [brands, setBrands] = useState([])
  const [brandCode, setBrandCode] = useState('')
  const [models, setModels] = useState([])
  const [modelCode, setModelCode] = useState('')
  const [years, setYears] = useState([])
  const [yearCode, setYearCode] = useState('')
  const [fipeInfo, setFipeInfo] = useState(null)
  const [loadingFipe, setLoadingFipe] = useState(false)
  const [fipeError, setFipeError] = useState(false)
  const [vinInfo, setVinInfo] = useState(null)
  const [loadingVin, setLoadingVin] = useState(false)
  const [vinError, setVinError] = useState(false)
  const [recalls, setRecalls] = useState(null)
  const [form, setForm] = useState({ plate: '', chassis: '', color: '', mileage: '', notes: '' })

  useEffect(() => { apiFetch('/api/clients').then(r => r.json()).then(setClients).catch(() => {}) }, [])
  useEffect(() => { if (!isUS) fetch(`${FIPE_BASE}/marcas`).then(r => r.ok ? r.json() : Promise.reject()).then(setBrands).catch(() => setFipeError(true)) }, [isUS])

  useEffect(() => {
    setModels([]); setModelCode(''); setYears([]); setYearCode(''); setFipeInfo(null)
    if (isUS || !brandCode) return
    fetch(`${FIPE_BASE}/marcas/${brandCode}/modelos`).then(r => r.json()).then(d => setModels(d.modelos)).catch(() => setFipeError(true))
  }, [brandCode, isUS])

  useEffect(() => {
    setYears([]); setYearCode(''); setFipeInfo(null)
    if (isUS || !brandCode || !modelCode) return
    fetch(`${FIPE_BASE}/marcas/${brandCode}/modelos/${modelCode}/anos`).then(r => r.json()).then(setYears).catch(() => setFipeError(true))
  }, [brandCode, modelCode, isUS])

  useEffect(() => {
    setFipeInfo(null)
    if (isUS || !brandCode || !modelCode || !yearCode) return
    setLoadingFipe(true)
    fetch(`${FIPE_BASE}/marcas/${brandCode}/modelos/${modelCode}/anos/${yearCode}`).then(r => r.json()).then(setFipeInfo).catch(() => setFipeError(true)).finally(() => setLoadingFipe(false))
  }, [brandCode, modelCode, yearCode, isUS])

  const change = e => setForm({ ...form, [e.target.name]: e.target.value })

  const lookupVin = async () => {
    const vin = form.chassis.trim().toUpperCase()
    setVinInfo(null); setRecalls(null); setVinError(false)
    if (!vin) return
    setLoadingVin(true)
    const data = await apiFetch(`/api/proxy/vin/${vin}`).then(r => r.ok ? r.json() : Promise.reject()).catch(() => { setVinError(true); return null })
    setLoadingVin(false)
    if (!data || !data.make) { setVinError(true); return }
    setVinInfo(data)
    if (data.make && data.model && data.model_year) {
      apiFetch(`/api/proxy/recalls/${encodeURIComponent(data.make)}/${encodeURIComponent(data.model)}/${data.model_year}`).then(r => r.ok ? r.json() : null).then(setRecalls).catch(() => {})
    }
  }

  const submit = e => {
    e.preventDefault()
    if (isUS) {
      if (!clientId || !vinInfo) return
      onSave({
        client_id: Number(clientId),
        plate: form.plate || null,
        chassis: form.chassis || null,
        brand: vinInfo.make,
        model: vinInfo.model,
        year_model: Number(vinInfo.model_year) || null,
        color: form.color || null,
        fuel: vinInfo.fuel || null,
        mileage: Number(form.mileage) || 0,
        notes: form.notes || null,
      })
      return
    }
    if (!clientId || !fipeInfo || !form.plate.trim()) return
    onSave({
      client_id: Number(clientId),
      plate: form.plate,
      chassis: form.chassis || null,
      brand: fipeInfo.Marca,
      model: fipeInfo.Modelo,
      year_model: Number(fipeInfo.AnoModelo),
      color: form.color || null,
      fuel: fipeInfo.Combustivel,
      mileage: Number(form.mileage) || 0,
      notes: form.notes || null,
    })
  }

  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">{t('vehicles.formTitle')}</span><h2>{t('vehicles.formHeading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{isUS ? t('vehicles.formIntroVin') : t('vehicles.formIntro')}</p>
    {!isUS && fipeError && <p className="field-hint fipe-error">{t('vehicles.fipeError')}</p>}
    {isUS && vinError && <p className="field-hint fipe-error">{t('vehicles.vinError')}</p>}
    {isUS && vinInfo && <p className="field-hint plate-match">{t('vehicles.vinFound', { make: vinInfo.make, model: vinInfo.model, year: vinInfo.model_year })}</p>}
    {isUS && recalls?.count > 0 && <p className="field-hint recall-warning">⚠ {t('vehicles.recallWarning', { count: recalls.count })}</p>}
    <div className="form-grid">
      <label>{t('vehicles.client')}<select required value={clientId} onChange={e => setClientId(e.target.value)}><option value="">{t('common.select')}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {isUS ? <>
        <label>{t('vehicles.vin')}<input required name="chassis" value={form.chassis} onChange={change} onBlur={lookupVin} placeholder="1FTFW1ET5BFC10312" /></label>
        <label>{t('vehicles.plate')}<input name="plate" value={form.plate} onChange={change} placeholder={t('common.optional')} /></label>
      </> : <>
        <label>{t('vehicles.plate')}<input required name="plate" value={form.plate} onChange={change} placeholder="ABC1D23" /></label>
        <label>{t('vehicles.brand')}<select required value={brandCode} onChange={e => setBrandCode(e.target.value)}><option value="">{t('common.select')}</option>{brands.map(b => <option key={b.codigo} value={b.codigo}>{b.nome}</option>)}</select></label>
        <label>{t('vehicles.model')}<select required value={modelCode} onChange={e => setModelCode(e.target.value)} disabled={!models.length}><option value="">{brandCode ? t('common.select') : t('vehicles.chooseBrandFirst')}</option>{models.map(m => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}</select></label>
        <label>{t('vehicles.yearFuel')}<select required value={yearCode} onChange={e => setYearCode(e.target.value)} disabled={!years.length}><option value="">{modelCode ? t('common.select') : t('vehicles.chooseModelFirst')}</option>{years.map(y => <option key={y.codigo} value={y.codigo}>{y.nome}</option>)}</select></label>
        <label>{t('vehicles.chassis')}<input name="chassis" value={form.chassis} onChange={change} placeholder={t('common.optional')} /></label>
      </>}
      <label>{t('vehicles.mileage')}<input name="mileage" value={form.mileage} onChange={change} placeholder="Ex.: 45200" /></label>
      <label>{t('vehicles.color')}<input name="color" value={form.color} onChange={change} placeholder={t('common.optional')} /></label>
    </div>
    {!isUS && loadingFipe && <p className="field-hint">{t('vehicles.consultingFipe')}</p>}
    {!isUS && fipeInfo && <p className="field-hint">{t('vehicles.fipeReference')} <b>{fipeInfo.Valor}</b> · {fipeInfo.Combustivel}</p>}
    {isUS && loadingVin && <p className="field-hint">{t('vehicles.consultingVin')}</p>}
    <label>{t('common.notes')}<textarea name="notes" value={form.notes} onChange={change} placeholder={t('common.notesPlaceholder')} /></label>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button><button className="primary" disabled={isUS ? !vinInfo : !fipeInfo}>{t('vehicles.saveVehicle')}</button></div>
  </form></div>
}

const orderStatusKeys = ['aberta', 'diagnostico', 'aguardando_aprovacao', 'aguardando_peca', 'em_execucao', 'teste_rodagem', 'pronto_entrega', 'entregue', 'cancelada']
const leadStageKeys = ['novo', 'contato_feito', 'orcamento', 'negociacao', 'ganho', 'perdido']

function stepSummary(step, t) {
  if (step.type === 'message') return step.template ? step.template.slice(0, 60) : t('automation.noMessageDefined')
  if (step.type === 'delay') return `${step.amount} ${t(`automation.${step.unit}Short`)}`
  if (step.type === 'condition') return t('automation.ifStillIs', { value: step.value })
  return ''
}

function FlowActionEditor({ action, onChange, module, triggerOptions }) {
  const { t } = useTranslation()
  return <div className="flow-action-editor">
    <select value={action.type} onChange={e => onChange({ type: e.target.value })}>
      <option value="message">{t('automation.sendMessage')}</option>
      {module === 'leads' && <option value="move_stage">{t('automation.moveStage')}</option>}
      <option value="alert">{t('automation.internalAlert')}</option>
    </select>
    {action.type === 'message' && <>
      <select value={action.channel || 'whatsapp'} onChange={e => onChange({ channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option></select>
      <textarea value={action.template || ''} onChange={e => onChange({ template: e.target.value })} placeholder={t('automation.messagePlaceholder')} />
    </>}
    {action.type === 'move_stage' && <select value={action.value || ''} onChange={e => onChange({ value: e.target.value })}><option value="">{t('common.select')}</option>{triggerOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
    {action.type === 'alert' && <input value={action.message || ''} onChange={e => onChange({ message: e.target.value })} placeholder={t('automation.internalAlertPlaceholder')} />}
  </div>
}

function FlowConnector({ onAdd }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return <div className="flow-connector">
    <div className="flow-line" />
    <button type="button" className="flow-add-btn" onClick={() => setOpen(v => !v)}>+</button>
    {open && <div className="flow-add-menu">
      <button type="button" onClick={() => { onAdd('message'); setOpen(false) }}>💬 {t('automation.sendMessage')}</button>
      <button type="button" onClick={() => { onAdd('delay'); setOpen(false) }}>⏱ {t('automation.wait')}</button>
      <button type="button" onClick={() => { onAdd('condition'); setOpen(false) }}>⑂ {t('automation.condition')}</button>
    </div>}
    <div className="flow-line" />
  </div>
}

const stepColor = { message: 'green', delay: 'slate', condition: 'purple' }
const stepIcon = { message: '💬', delay: '⏱', condition: '⑂' }

function FlowStepBlock({ step, isOpen, onToggle, onChange, onRemove, triggerOptions, module }) {
  const { t } = useTranslation()
  return <div className={`flow-block step-block ${stepColor[step.type]}`}>
    <button type="button" className="flow-block-head" onClick={onToggle}>
      <span className="flow-block-icon">{stepIcon[step.type]}</span>
      <div><strong>{t(`automation.${step.type === 'message' ? 'sendMessage' : step.type === 'delay' ? 'wait' : 'condition'}`)}</strong><span>{stepSummary(step, t)}</span></div>
      <span className="flow-block-toggle">{isOpen ? '▲' : '▼'}</span>
    </button>
    {isOpen && <div className="flow-block-body">
      {step.type === 'message' && <>
        <select value={step.channel} onChange={e => onChange({ channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option></select>
        <textarea value={step.template} onChange={e => onChange({ template: e.target.value })} placeholder="Olá {cliente}! Seu {veiculo} ({placa})..." />
        <p className="field-hint">{t('automation.variablesHint', { vars: '{cliente} {placa} {veiculo} {os} {valor}' })}</p>
      </>}
      {step.type === 'delay' && <div className="flow-delay-fields">
        <input type="number" min="1" value={step.amount} onChange={e => onChange({ amount: Number(e.target.value) })} />
        <select value={step.unit} onChange={e => onChange({ unit: e.target.value })}><option value="minutes">{t('automation.minutes')}</option><option value="hours">{t('automation.hours')}</option><option value="days">{t('automation.days')}</option></select>
      </div>}
      {step.type === 'condition' && <>
        <label className="condition-field">{t('automation.triggerStillIs')}<select value={step.value} onChange={e => onChange({ value: e.target.value })}>{triggerOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>?</label>
        <div className="flow-branches">
          <div className="flow-branch yes"><span className="branch-label">{t('automation.yes')}</span><FlowActionEditor action={step.thenAction} onChange={patch => onChange({ thenAction: { ...step.thenAction, ...patch } })} module={module} triggerOptions={triggerOptions} /></div>
          <div className="flow-branch no"><span className="branch-label">{t('automation.no')}</span><FlowActionEditor action={step.elseAction} onChange={patch => onChange({ elseAction: { ...step.elseAction, ...patch } })} module={module} triggerOptions={triggerOptions} /></div>
        </div>
      </>}
      <button type="button" className="text-btn danger" onClick={onRemove}>{t('automation.removeStep')}</button>
    </div>}
  </div>
}

function FlowEditor({ flow, onBack, onSaved, notify }) {
  const { t } = useTranslation()
  const orderStatusOptions = orderStatusKeys.map(k => [k, t(`status.${k}`)])
  const leadStageOptions = leadStageKeys.map(k => [k, t(`leadStage.${k}`)])
  const [name, setName] = useState(flow.name)
  const [module, setModule] = useState(flow.module)
  const [triggerValue, setTriggerValue] = useState(flow.trigger_value)
  const [steps, setSteps] = useState(flow.steps || [])
  const [openStep, setOpenStep] = useState(null)

  const triggerOptions = module === 'service_orders' ? orderStatusOptions : leadStageOptions

  const addStep = (type, atIndex) => {
    const base = type === 'message' ? { type, channel: 'whatsapp', template: '' }
      : type === 'delay' ? { type, amount: 2, unit: 'hours' }
      : { type: 'condition', value: triggerValue, thenAction: { type: 'message', channel: 'whatsapp', template: '' }, elseAction: { type: 'message', channel: 'whatsapp', template: '' } }
    setSteps(prev => { const copy = [...prev]; copy.splice(atIndex, 0, base); return copy })
    setOpenStep(atIndex)
  }
  const updateStep = (index, patch) => setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s))
  const removeStep = (index) => setSteps(prev => prev.filter((_, i) => i !== index))

  const save = async () => {
    if (!name.trim()) return notify(t('automation.giveNameFirst'))
    const triggerField = module === 'service_orders' ? 'status' : 'stage'
    const payload = { name, module, trigger_field: triggerField, trigger_value: triggerValue, steps }
    const res = flow.id
      ? await apiFetch(`/api/automation-flows/${flow.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await apiFetch('/api/automation-flows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) return notify(t('automation.cannotSaveFlow'))
    notify(t('automation.flowSaved'))
    onSaved()
  }

  return <div className="flow-editor">
    <div className="modal-head"><div><span className="eyebrow">{t('automation.title')}</span><h2>{flow.id ? t('automation.editFlowTitle') : t('automation.newFlowTitle')}</h2></div><button type="button" onClick={onBack}>×</button></div>
    <div className="form-grid">
      <label>{t('automation.flowName')}<input value={name} onChange={e => setName(e.target.value)} placeholder={t('automation.flowNamePlaceholder')} /></label>
      <label>{t('automation.when')}<select value={module} onChange={e => { const m = e.target.value; setModule(m); setTriggerValue(m === 'service_orders' ? orderStatusOptions[2][0] : leadStageOptions[0][0]) }}><option value="service_orders">{t('automation.whenOrderStatus')}</option><option value="leads">{t('automation.whenLeadStage')}</option></select></label>
    </div>
    <div className="flow-canvas">
      <div className="flow-block trigger-block">
        <span className="flow-block-icon">⚡</span>
        <div><strong>{t('automation.trigger')}</strong><span>{module === 'service_orders' ? t('automation.triggerOrderStatus') : t('automation.triggerLeadStage')} <select value={triggerValue} onChange={e => setTriggerValue(e.target.value)}>{triggerOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span></div>
      </div>
      <FlowConnector onAdd={(type) => addStep(type, 0)} />
      {steps.map((step, i) => <div key={i} className="flow-step-wrap">
        <FlowStepBlock step={step} isOpen={openStep === i} onToggle={() => setOpenStep(openStep === i ? null : i)} onChange={patch => updateStep(i, patch)} onRemove={() => removeStep(i)} triggerOptions={triggerOptions} module={module} />
        {step.type !== 'condition' && <FlowConnector onAdd={(type) => addStep(type, i + 1)} />}
      </div>)}
      {!steps.length && <p className="empty-hint">{t('automation.addFirstStep')}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onBack}>{t('common.back')}</button><button type="button" className="primary" onClick={save}>{t('automation.saveFlow')}</button></div>
  </div>
}

function FlowList({ flows, onNew, onEdit, onClose, onDelete, onToggle }) {
  const { t } = useTranslation()
  return <>
    <div className="modal-head"><div><span className="eyebrow">{t('automation.title')}</span><h2>{t('automation.flowsTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('automation.flowsIntro')}</p>
    <button type="button" className="primary" style={{ marginBottom: 16 }} onClick={onNew}>{t('automation.newFlow')}</button>
    <div className="rule-list">
      {!flows.length && <p className="empty-hint">{t('automation.noFlows')}</p>}
      {flows.map(f => <div className="rule-row" key={f.id}>
        <span><b>{f.name}</b><br /><small>{f.module === 'service_orders' ? 'OS' : 'Lead'} → {f.trigger_value} · {t('automation.stageCount', { count: f.steps.length })}</small></span>
        <button type="button" className="text-btn" onClick={() => onToggle(f)}>{f.active ? t('common.deactivate') : t('common.activate')}</button>
        <button type="button" className="text-btn" onClick={() => onEdit(f)}>{t('common.edit')}</button>
        <button type="button" className="text-btn danger" onClick={() => onDelete(f.id)}>{t('common.delete')}</button>
      </div>)}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button></div>
  </>
}

function FlowBuilderModal({ onClose, notify }) {
  const { t } = useTranslation()
  const [flows, setFlows] = useState([])
  const [editingFlow, setEditingFlow] = useState(null)
  const [blocked, setBlocked] = useState(null)
  const load = useCallback(() => apiFetch('/api/automation-flows').then(async r => { if (r.status === 403) { const data = await r.json().catch(() => ({})); setBlocked(data.error || t('automation.planRequired')); return [] } setBlocked(null); return r.json() }).then(setFlows).catch(() => {}), [t])
  useEffect(() => { load() }, [load])
  const onDelete = async (id) => { await apiFetch(`/api/automation-flows/${id}`, { method: 'DELETE' }); load() }
  const onToggle = async (flow) => { await apiFetch(`/api/automation-flows/${flow.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !flow.active }) }); load() }
  return <div className="modal-backdrop"><div className="modal flow-modal">
    {blocked ? <>
      <div className="modal-head"><div><span className="eyebrow">{t('automation.title')}</span><h2>{t('automation.flowsTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
      <p className="field-hint plate-new">{blocked}</p>
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button></div>
    </> : !editingFlow
      ? <FlowList flows={flows} onNew={() => setEditingFlow({ name: '', module: 'service_orders', trigger_value: orderStatusKeys[2], steps: [] })} onEdit={setEditingFlow} onClose={onClose} onDelete={onDelete} onToggle={onToggle} />
      : <FlowEditor flow={editingFlow} onBack={() => setEditingFlow(null)} onSaved={() => { setEditingFlow(null); load() }} notify={notify} />}
  </div></div>
}

function ChatPage({ notify }) {
  const { t } = useTranslation()
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [pendingContact, setPendingContact] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [showNew, setShowNew] = useState(false)

  const loadConversations = useCallback(() => apiFetch('/api/conversations').then(r => r.json()).then(setConversations).catch(() => {}), [])
  useEffect(() => { loadConversations() }, [loadConversations])

  const active = pendingContact || conversations.find(c => `${c.client_id ? 'client' : 'lead'}:${c.client_id || c.lead_id}` === activeId)

  const loadMessages = useCallback(() => {
    if (!active) return setMessages([])
    const param = active.client_id ? `client_id=${active.client_id}` : `lead_id=${active.lead_id}`
    apiFetch(`/api/messages?${param}`).then(r => r.json()).then(rows => setMessages(rows.slice().reverse())).catch(() => {})
  }, [active])
  useEffect(() => { loadMessages() }, [loadMessages])

  const send = async (e) => {
    e.preventDefault()
    if (!draft.trim() || !active) return
    if (!active.contact_phone) return notify(t('chat.noPhoneForContact'))
    const res = await apiFetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'whatsapp', recipient: active.contact_phone, content: draft.trim(), client_id: active.client_id || null, lead_id: active.lead_id || null }) })
    if (!res.ok) return notify(t('chat.cannotSend'))
    setDraft('')
    if (pendingContact) { setActiveId(`client:${pendingContact.client_id}`); setPendingContact(null) }
    loadMessages()
    loadConversations()
  }
  const retry = async (id) => { await apiFetch(`/api/messages/${id}/retry`, { method: 'POST' }); loadMessages() }
  const startConversation = (client) => { setPendingContact({ client_id: client.id, contact_name: client.name, contact_phone: client.phone }); setActiveId(null); setShowNew(false) }

  return <div className="chat-layout">
    <aside className="chat-list">
      <div className="chat-list-head"><button type="button" className="text-btn" onClick={() => setShowNew(true)}>{t('chat.newConversation')}</button></div>
      {conversations.map(c => { const id = `${c.client_id ? 'client' : 'lead'}:${c.client_id || c.lead_id}`; return <button key={id} className={`chat-item${activeId === id ? ' active' : ''}`} onClick={() => { setPendingContact(null); setActiveId(id) }}>
        <div className="avatar coral">{initials(c.contact_name)}</div>
        <div><strong>{c.contact_name || t('chat.noName')}</strong><span>{c.direction === 'saida' ? t('chat.you') : ''}{c.content}</span></div>
      </button> })}
      {!conversations.length && <p className="empty-hint">{t('chat.noConversations')}</p>}
    </aside>
    <section className="chat-thread">
      {!active ? <div className="detail-empty"><p>{t('chat.selectHint')}</p></div> : <>
        <div className="chat-thread-head"><strong>{active.contact_name}</strong><span>{active.contact_phone || t('common.noPhone')}</span></div>
        <div className="chat-messages">
          {messages.map(m => <div key={m.id} className={`chat-bubble ${m.direction === 'saida' ? 'out' : 'in'}`}>
            <p>{m.content}</p>
            <small>{new Date(m.created_at).toLocaleString('pt-BR')}{m.status === 'erro' && <button type="button" className="text-btn" onClick={() => retry(m.id)}>{t('chat.resend')}</button>}</small>
          </div>)}
          {!messages.length && <p className="empty-hint">{t('chat.noMessages')}</p>}
        </div>
        <form className="chat-input" onSubmit={send}><input value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('chat.messagePlaceholder')} /><button className="primary">{t('chat.send')}</button></form>
      </>}
    </section>
    {showNew && <NewConversationModal onClose={() => setShowNew(false)} onSelect={startConversation} />}
  </div>
}

function NewConversationModal({ onClose, onSelect }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [clients, setClients] = useState([])
  useEffect(() => { apiFetch(`/api/clients?search=${encodeURIComponent(query)}`).then(r => r.json()).then(setClients).catch(() => {}) }, [query])
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><span className="eyebrow">{t('chat.newConversationTitle')}</span><h2>{t('chat.newConversationHeading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('chat.newConversationIntro')}</p>
    <input className="vehicle-search" autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('chat.searchPlaceholder')} style={{ marginBottom: 14, width: '100%' }} />
    <div className="vehicle-list">
      {clients.map(c => <button key={c.id} type="button" className="vehicle-row" onClick={() => onSelect(c)}>
        <span><b>{c.name}</b></span><span>{c.phone || t('common.noPhone')}</span>
      </button>)}
      {!clients.length && <p className="empty-hint">{t('chat.noClientsFound')}</p>}
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button></div>
  </div></div>
}

function toLocalISO(date) { const pad = n => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` }
function startOfWeek(date) { const d = new Date(date); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d }
const agendaHours = Array.from({ length: 12 }, (_, i) => 8 + i)
const appointmentStatusKeys = ['agendado', 'confirmado', 'concluido', 'cancelado']

function AgendaPage({ notify }) {
  const { t } = useTranslation()
  const weekDayLabels = t('weekDays', { returnObjects: true })
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [appointments, setAppointments] = useState([])
  const [mechanics, setMechanics] = useState([])
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    apiFetch(`/api/appointments?start=${toLocalISO(weekStart)}&end=${toLocalISO(addDays(weekStart, 7))}`).then(r => r.json()).then(setAppointments).catch(() => {})
  }, [weekStart])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/employees?active=1').then(r => r.json()).then(setMechanics).catch(() => {}) }, [])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const apptsAt = (day, hour) => appointments.filter(a => { const d = new Date(a.scheduled_at); return d.toDateString() === day.toDateString() && d.getHours() === hour })

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">{t('agenda.title')}</span><h1>{t('agenda.heading')}</h1><p>{t('agenda.weekOf', { start: weekStart.toLocaleDateString('pt-BR'), end: addDays(weekStart, 6).toLocaleDateString('pt-BR') })}</p></div>
      <div className="agenda-nav">
        <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>{t('agenda.previous')}</button>
        <button className="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>{t('agenda.today')}</button>
        <button className="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>{t('agenda.next')}</button>
        <button className="primary new-os" onClick={() => setEditing({ scheduled_at: toLocalISO(new Date()).slice(0, 16) })}>{t('agenda.newAppointment')}</button>
      </div>
    </div>
    <section className="panel calendar-panel">
      <div className="calendar-header"><div className="calendar-corner"></div>{days.map(d => <div className="calendar-daylabel" key={d.toISOString()}><span>{weekDayLabels[d.getDay()]}</span><b>{d.getDate()}</b></div>)}</div>
      <div className="calendar-body">
        {agendaHours.map(h => <div className="calendar-row" key={h}>
          <div className="calendar-hour">{String(h).padStart(2, '0')}:00</div>
          {days.map(d => <div className="calendar-cell" key={d.toISOString()} onClick={() => setEditing({ scheduled_at: toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h)).slice(0, 16) })}>
            {apptsAt(d, h).map(a => <button type="button" key={a.id} className={`appt-block appt-${a.status}`} onClick={e => { e.stopPropagation(); setEditing(a) }}>
              <strong>{new Date(a.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} {a.title}</strong>
              <small>{a.mechanic_name || t('agenda.noMechanic')} · {a.client_name}</small>
            </button>)}
          </div>)}
        </div>)}
      </div>
    </section>
    {editing && <AppointmentModal appointment={editing} mechanics={mechanics} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} notify={notify} />}
  </>
}

function AppointmentModal({ appointment, mechanics, onClose, onSaved, notify }) {
  const { t } = useTranslation()
  const isNew = !appointment.id
  const [clients, setClients] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [form, setForm] = useState({
    client_id: appointment.client_id || '',
    vehicle_id: appointment.vehicle_id || '',
    mechanic_id: appointment.mechanic_id || '',
    title: appointment.title || '',
    scheduled_at: appointment.scheduled_at ? appointment.scheduled_at.slice(0, 16) : '',
    duration_minutes: appointment.duration_minutes || 60,
    notes: appointment.notes || '',
  })
  useEffect(() => { apiFetch('/api/clients').then(r => r.json()).then(setClients).catch(() => {}) }, [])
  useEffect(() => { if (!form.client_id) return setVehicles([]); apiFetch('/api/vehicles').then(r => r.json()).then(rows => setVehicles(rows.filter(v => v.client_id === Number(form.client_id)))).catch(() => {}) }, [form.client_id])

  const change = e => setForm({ ...form, [e.target.name]: e.target.value })

  const save = async (e) => {
    e.preventDefault()
    const payload = { ...form, client_id: Number(form.client_id), vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null, mechanic_id: form.mechanic_id ? Number(form.mechanic_id) : null, duration_minutes: Number(form.duration_minutes) }
    const res = isNew
      ? await apiFetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await apiFetch(`/api/appointments/${appointment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('agenda.cannotSave'))
    notify(isNew ? t('agenda.created') : t('agenda.updated'))
    onSaved()
  }
  const remove = async () => { await apiFetch(`/api/appointments/${appointment.id}`, { method: 'DELETE' }); notify(t('agenda.removed')); onSaved() }
  const setStatus = async (status) => { await apiFetch(`/api/appointments/${appointment.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); notify(t('agenda.statusUpdated')); onSaved() }

  return <div className="modal-backdrop"><form className="modal" onSubmit={save}>
    <div className="modal-head"><div><span className="eyebrow">{t('agenda.title')}</span><h2>{isNew ? t('agenda.newTitle') : t('agenda.editTitle')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <div className="form-grid">
      <label>{t('agenda.client')}<select required name="client_id" value={form.client_id} onChange={change}><option value="">{t('common.select')}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{t('agenda.vehicle')}<select name="vehicle_id" value={form.vehicle_id} onChange={change} disabled={!vehicles.length}><option value="">{form.client_id ? (vehicles.length ? t('common.select') : t('agenda.noVehicles')) : t('agenda.chooseClient')}</option>{vehicles.map(v => <option key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model}</option>)}</select></label>
      <label>{t('agenda.mechanic')}<select name="mechanic_id" value={form.mechanic_id} onChange={change}><option value="">{t('agenda.noAssignment')}</option>{mechanics.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>{t('agenda.duration')}<input type="number" min="15" step="15" name="duration_minutes" value={form.duration_minutes} onChange={change} /></label>
      <label>{t('agenda.dateTime')}<input required type="datetime-local" name="scheduled_at" value={form.scheduled_at} onChange={change} /></label>
      <label>{t('agenda.title2')}<input required name="title" value={form.title} onChange={change} placeholder={t('agenda.titlePlaceholder')} /></label>
    </div>
    <label>{t('common.notes')}<textarea name="notes" value={form.notes} onChange={change} placeholder={t('common.notesPlaceholder')} /></label>
    {!isNew && <div className="filters agenda-status-filters">{appointmentStatusKeys.map(key => <button type="button" key={key} className={appointment.status === key ? 'filter-active' : ''} onClick={() => setStatus(key)}>{t(`agenda.status${key.charAt(0).toUpperCase()}${key.slice(1)}`)}</button>)}</div>}
    <div className="modal-actions">
      {!isNew && <button type="button" className="text-btn danger" onClick={remove}>{t('common.delete')}</button>}
      <button type="button" className="secondary" onClick={onClose}>{t('common.cancel')}</button>
      <button className="primary">{isNew ? t('agenda.create') : t('agenda.save')} →</button>
    </div>
  </form></div>
}

const employeeRoleKeys = ['mecanico', 'atendente', 'gerente', 'lavador', 'eletricista']

function EmployeeModal({ onClose, notify }) {
  const { t } = useTranslation()
  const [employees, setEmployees] = useState([])
  const [name, setName] = useState('')
  const [role, setRole] = useState(employeeRoleKeys[0])
  const [phone, setPhone] = useState('')
  const [specialty, setSpecialty] = useState('')

  const load = useCallback(() => apiFetch('/api/employees').then(r => r.json()).then(setEmployees).catch(() => {}), [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    const res = await apiFetch('/api/employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, role, phone: phone || null, specialty: specialty || null }) })
    if (!res.ok) return notify(t('employees.cannotRegister'))
    setName(''); setPhone(''); setSpecialty('')
    load()
    notify(t('employees.registered'))
  }
  const toggleActive = async (employee) => { await apiFetch(`/api/employees/${employee.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !employee.active }) }); load() }

  return <div className="modal-backdrop"><form className="modal automation-modal" onSubmit={create}>
    <div className="modal-head"><div><span className="eyebrow">{t('employees.title')}</span><h2>{t('employees.heading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('employees.intro')}</p>
    <div className="form-grid">
      <label>{t('employees.name')}<input required value={name} onChange={e => setName(e.target.value)} placeholder={t('employees.namePlaceholder')} /></label>
      <label>{t('employees.role')}<select value={role} onChange={e => setRole(e.target.value)}>{employeeRoleKeys.map(k => <option key={k} value={k}>{t(`employeeRole.${k}`)}</option>)}</select></label>
      <label>{t('employees.phone')}<input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999" /></label>
      <label>{t('employees.specialty')}<input value={specialty} onChange={e => setSpecialty(e.target.value)} placeholder={t('employees.specialtyPlaceholder')} /></label>
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button><button className="primary">{t('employees.register')}</button></div>
    <div className="rule-list">
      {employees.length === 0 && <p className="empty-hint">{t('employees.noEmployees')}</p>}
      {employees.map(emp => <div className="rule-row" key={emp.id}>
        <span><b>{emp.name}</b><br /><small>{t(`employeeRole.${emp.role}`, { defaultValue: emp.role })}{emp.specialty ? ` · ${emp.specialty}` : ''}{emp.phone ? ` · ${emp.phone}` : ''}</small></span>
        <button type="button" className="text-btn" onClick={() => toggleActive(emp)}>{emp.active ? t('common.deactivate') : t('common.activate')}</button>
      </div>)}
    </div>
  </form></div>
}

function TeamModal({ onClose, notify, user }) {
  const { t } = useTranslation()
  const [team, setTeam] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const isOwner = user.role === 'owner'
  const load = useCallback(() => apiFetch('/api/team').then(r => r.json()).then(setTeam).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const create = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || password.length < 6) return notify(t('team.invalidForm'))
    const res = await apiFetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password }) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('team.cannotCreate'))
    setName(''); setEmail(''); setPassword(''); load(); notify(t('team.created'))
  }
  const toggleActive = async (member) => { await apiFetch(`/api/team/${member.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !member.active }) }); load() }
  return <div className="modal-backdrop"><div className="modal automation-modal">
    <div className="modal-head"><div><span className="eyebrow">{t('team.title')}</span><h2>{t('team.heading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('team.intro')}</p>
    <div className="rule-list">
      {team.map(m => <div className="rule-row" key={m.id}>
        <span><b>{m.name}</b><br /><small>{m.email} · {t(`team.role_${m.role}`)}</small></span>
        {isOwner && m.id !== user.id && <button type="button" className="text-btn" onClick={() => toggleActive(m)}>{m.active ? t('common.deactivate') : t('common.activate')}</button>}
      </div>)}
      {!team.length && <p className="empty-hint">{t('common.loading')}</p>}
    </div>
    {isOwner && <form className="form-grid" style={{ marginTop: 18 }} onSubmit={create}>
      <label>{t('team.name')}<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('login.email')}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t('team.password')}<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <div className="modal-actions" style={{ gridColumn: '1/-1' }}><button className="primary">{t('team.invite')}</button></div>
    </form>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button></div>
  </div></div>
}

function LaborCalculatorModal({ onClose }) {
  const { t } = useTranslation()
  const [fixedCosts, setFixedCosts] = useState('')
  const [mechanics, setMechanics] = useState('1')
  const [hoursPerDay, setHoursPerDay] = useState('6')
  const [workDays, setWorkDays] = useState('22')
  const [margin, setMargin] = useState('30')
  const productiveHours = Number(mechanics || 0) * Number(hoursPerDay || 0) * Number(workDays || 0)
  const costPerHour = productiveHours > 0 ? Number(fixedCosts || 0) / productiveHours : 0
  const marginFraction = Math.min(0.95, Math.max(0, Number(margin || 0) / 100))
  const suggestedRate = marginFraction < 1 ? costPerHour / (1 - marginFraction) : costPerHour
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><span className="eyebrow">{t('laborCalc.eyebrow')}</span><h2>{t('laborCalc.heading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <p className="modal-intro">{t('laborCalc.intro')}</p>
    <div className="form-grid">
      <label>{t('laborCalc.fixedCosts')}<input type="number" value={fixedCosts} onChange={e => setFixedCosts(e.target.value)} placeholder="15000" /></label>
      <label>{t('laborCalc.mechanics')}<input type="number" value={mechanics} onChange={e => setMechanics(e.target.value)} /></label>
      <label>{t('laborCalc.hoursPerDay')}<input type="number" value={hoursPerDay} onChange={e => setHoursPerDay(e.target.value)} /></label>
      <label>{t('laborCalc.workDays')}<input type="number" value={workDays} onChange={e => setWorkDays(e.target.value)} /></label>
      <label>{t('laborCalc.margin')}<input type="number" value={margin} onChange={e => setMargin(e.target.value)} /></label>
    </div>
    <div className="detail-section">
      <h3>{t('laborCalc.resultTitle')}</h3>
      <div className="line-item"><span>{t('laborCalc.productiveHours')}</span><b>{productiveHours.toLocaleString('pt-BR')} h/{t('laborCalc.perMonth')}</b></div>
      <div className="line-item"><span>{t('laborCalc.costPerHour')}</span><b>{money(costPerHour) || '—'}</b></div>
      <div className="total"><span>{t('laborCalc.suggestedRate')}</span><strong>{money(suggestedRate) || '—'}</strong></div>
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button></div>
  </div></div>
}

function WhatsappIntegrationForm({ notify }) {
  const { t } = useTranslation()
  const [phoneId, setPhoneId] = useState('')
  const [instance, setInstance] = useState('')
  const save = async (e) => {
    e.preventDefault()
    const res = await apiFetch('/api/workshop/whatsapp-integration', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ whatsapp_phone_id: phoneId || null, whatsapp_instance: instance || null }) })
    const data = await res.json()
    notify(res.ok ? t('settings.whatsappSaved') : (data.error || t('settings.whatsappSaved')))
  }
  return <form onSubmit={save}>
    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{t('settings.whatsappIntegrationHint')}</p>
    <label style={{ display: 'grid', gap: 6, fontSize: 11, fontWeight: 700, color: '#536276', marginBottom: 10 }}>{t('settings.whatsappPhoneId')}<input value={phoneId} onChange={e => setPhoneId(e.target.value)} placeholder="1234567890" /></label>
    <label style={{ display: 'grid', gap: 6, fontSize: 11, fontWeight: 700, color: '#536276', marginBottom: 10 }}>{t('settings.whatsappInstance')}<input value={instance} onChange={e => setInstance(e.target.value)} placeholder="oficina-prime" /></label>
    <button type="submit" className="secondary">{t('common.save')}</button>
  </form>
}

function TotpSection({ notify }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(null)
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const load = useCallback(() => apiFetch('/api/auth/me').then(r => r.json()).then(d => setEnabled(!!d.totp_enabled)).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  const startSetup = async () => {
    const res = await apiFetch('/api/auth/totp/setup', { method: 'POST' })
    if (res.ok) setSetup(await res.json())
  }
  const confirmEnable = async (e) => {
    e.preventDefault()
    const res = await apiFetch('/api/auth/totp/enable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    const data = await res.json()
    if (!res.ok) return notify(data.error || t('settings.totpInvalidCode'))
    setSetup(null); setCode(''); load(); notify(t('settings.totpEnabled'))
  }
  const disable = async () => {
    await apiFetch('/api/auth/totp/disable', { method: 'POST' })
    load(); notify(t('settings.totpDisabled'))
  }
  if (enabled === null) return null
  return <div className="settings-section">
    <h3>{t('settings.totpTitle')}</h3>
    {enabled ? <>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{t('settings.totpEnabledHint')}</p>
      <button type="button" className="text-btn danger" onClick={disable}>{t('settings.totpDisableAction')}</button>
    </> : setup ? <form onSubmit={confirmEnable}>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>{t('settings.totpSetupHint')}</p>
      <code style={{ display: 'block', background: '#f5f8fd', padding: '10px 12px', borderRadius: 7, fontSize: 13, letterSpacing: 1, margin: '0 0 12px', wordBreak: 'break-all' }}>{setup.secret}</code>
      <label style={{ display: 'grid', gap: 6, fontSize: 11, fontWeight: 700, color: '#536276', marginBottom: 10 }}>{t('settings.totpCodeLabel')}<input required inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" /></label>
      <button type="submit" className="primary">{t('settings.totpConfirm')}</button>
    </form> : <>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{t('settings.totpDisabledHint')}</p>
      <button type="button" className="secondary" onClick={startSetup}>{t('settings.totpEnableAction')}</button>
    </>}
  </div>
}

function SettingsModal({ onClose, user, onLogout }) {
  const { t } = useTranslation()
  const [toast, setToast] = useState('')
  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400) }
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><span className="eyebrow">{t('settings.title')}</span><h2>{t('settings.heading')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    <div className="settings-section">
      <h3>{t('settings.account')}</h3>
      <div className="settings-row"><span>{t('settings.name')}</span><b>{user.name}</b></div>
      <div className="settings-row"><span>{t('settings.email')}</span><b>{user.email}</b></div>
      <div className="settings-row"><span>{t('settings.role')}</span><b>{t(`employeeRole.${user.role}`, { defaultValue: user.role })}</b></div>
    </div>
    {user.tenant_name && <div className="settings-section">
      <h3>{t('settings.workshop')}</h3>
      <div className="settings-row"><span>{t('settings.name')}</span><b>{user.tenant_name}</b></div>
      <div className="settings-row"><span>{t('settings.plan')}</span><b>{t(`admin.plan_${user.tenant_plan}`, { defaultValue: user.tenant_plan })}</b></div>
      <div className="settings-row"><span>{t('settings.currency')}</span><b>{user.tenant_currency}</b></div>
      <div className="settings-row"><span>{t('settings.distanceUnit')}</span><b>{t(`settings.distanceUnit_${user.tenant_distance_unit}`, { defaultValue: user.tenant_distance_unit })}</b></div>
    </div>}
    <TotpSection notify={notify} />
    {user.role === 'owner' && <div className="settings-section">
      <h3>{t('settings.whatsappIntegration')}</h3>
      <WhatsappIntegrationForm notify={notify} />
    </div>}
    <div className="settings-section">
      <h3>{t('settings.language')}</h3>
      <div className="lang-switch settings-lang-switch">{languages.map(([code, label]) => <button key={code} type="button" className={i18n.language === code ? 'active' : ''} onClick={() => i18n.changeLanguage(code)}>{label}</button>)}</div>
    </div>
    {toast && <p style={{ fontSize: 12, color: 'var(--success)', margin: '0 0 10px' }}>✓ {toast}</p>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button><button type="button" className="text-btn danger" onClick={onLogout}>{t('settings.logout')}</button></div>
  </div></div>
}

function LoginScreen({ onLogin, onBack }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': i18n.language }, body: JSON.stringify({ email, password, totp_code: totpRequired ? totpCode : undefined }) })
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { if (data.totp_required) setTotpRequired(true); return setError(data.error || t('login.error')) }
    onLogin(data)
  }
  return <div className="login-screen">
    <form className="login-card" onSubmit={submit}>
      {onBack && <button type="button" className="text-btn login-back" onClick={onBack}>{t('login.back')}</button>}
      <div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div>
      <h1>{t('login.title')}</h1>
      <p>{t('login.subtitle')}</p>
      {error && <div className="login-error">{error}</div>}
      <label>{t('login.email')}<input type="email" required autoFocus disabled={totpRequired} value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t('login.password')}<input type="password" required disabled={totpRequired} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {totpRequired && <label>{t('login.totpCode')}<input required autoFocus inputMode="numeric" maxLength={6} value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" /></label>}
      <button className="primary" disabled={loading}>{loading ? t('login.loading') : t('login.submit')}</button>
    </form>
  </div>
}

const landingFeatureIcons = ['clipboard', 'funnel', 'gear', 'chart', 'wrench', 'garage']
const landingStatIcons = ['🌎', '💬', '🔒']

function LandingPage({ onLogin }) {
  const { t } = useTranslation()
  const [openFaq, setOpenFaq] = useState(null)
  const features = [1, 2, 3, 4, 5, 6].map((n, i) => ({ icon: landingFeatureIcons[i], title: t(`landing.feature${n}Title`), desc: t(`landing.feature${n}Desc`) }))
  const stats = [1, 2, 3].map((n, i) => ({ icon: landingStatIcons[i], value: t(`landing.stat${n}Value`), label: t(`landing.stat${n}Label`) }))
  const plans = ['starter', 'pro', 'scale']
  const contactHref = 'mailto:contato@oficinapro.com'
  return <div className="landing">
    <header className="landing-nav">
      <div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div>
      <nav className="landing-nav-links">
        <a href="#recursos">{t('landing.navFeatures')}</a>
        <a href="#pricing">{t('landing.navPricing')}</a>
        <a href="#faq">{t('landing.navFaq')}</a>
      </nav>
      <div className="landing-nav-actions">
        <div className="lang-switch">{languages.map(([code, label]) => <button key={code} type="button" className={i18n.language === code ? 'active' : ''} onClick={() => i18n.changeLanguage(code)}>{label}</button>)}</div>
        <button type="button" className="text-btn landing-nav-login" onClick={onLogin}>{t('landing.navLogin')}</button>
      </div>
    </header>
    <section className="landing-hero">
      <div className="landing-hero-copy">
        <span className="landing-badge">{t('landing.badge')}</span>
        <h1>{t('landing.heroTitle')}</h1>
        <p>{t('landing.heroSubtitle')}</p>
        <div className="landing-hero-actions">
          <a className="primary" href={contactHref}>{t('landing.heroCta')}</a>
          <a className="secondary" href="#pricing">{t('landing.heroCtaSecondary')}</a>
        </div>
        <p className="landing-trusted">{t('landing.trustedBy')}</p>
      </div>
      <div className="landing-hero-visual">
        <div className="landing-browser-frame">
          <div className="landing-browser-bar"><span></span><span></span><span></span></div>
          <img src="/dashboard-preview.png" alt="Painel do OficinaPro" />
        </div>
      </div>
    </section>
    <section className="landing-stats">
      {stats.map((s, i) => <div className="landing-stat" key={i}><span className="landing-stat-icon">{s.icon}</span><div><strong>{s.value}</strong><span>{s.label}</span></div></div>)}
    </section>
    <section className="landing-features" id="recursos">
      <span className="landing-eyebrow">{t('landing.featuresEyebrow')}</span>
      <h2>{t('landing.featuresTitle')}</h2>
      <div className="landing-features-grid">
        {features.map((f, i) => <div className="landing-feature-card" key={i}><div className="landing-feature-icon"><Icon name={f.icon} size={20} /></div><h3>{f.title}</h3><p>{f.desc}</p></div>)}
      </div>
    </section>
    <section className="landing-pricing" id="pricing">
      <span className="landing-eyebrow">{t('landing.pricingEyebrow')}</span>
      <h2>{t('landing.pricingTitle')}</h2>
      <p>{t('landing.pricingSubtitle')}</p>
      <div className="landing-pricing-grid">
        {plans.map(p => <div className={`landing-plan-card${p === 'pro' ? ' featured' : ''}`} key={p}>
          {p === 'pro' && <span className="landing-plan-badge">{t('landing.popular')}</span>}
          <h3>{t(`landing.plan_${p}_name`)}</h3>
          <strong>{t(`landing.plan_${p}_price`)}</strong>
          <p>{t(`landing.plan_${p}_desc`)}</p>
          <ul>{[1, 2, 3].map(n => <li key={n}>{t(`landing.plan_${p}_f${n}`)}</li>)}</ul>
          <a className={p === 'pro' ? 'primary' : 'secondary'} href={contactHref}>{t('landing.pricingCta')}</a>
        </div>)}
      </div>
    </section>
    <section className="landing-faq" id="faq">
      <span className="landing-eyebrow">{t('landing.faqEyebrow')}</span>
      <h2>{t('landing.faqTitle')}</h2>
      <div className="landing-faq-list">
        {[1, 2, 3].map(n => <div className={`landing-faq-item${openFaq === n ? ' open' : ''}`} key={n}>
          <button type="button" className="landing-faq-question" onClick={() => setOpenFaq(openFaq === n ? null : n)}>{t(`landing.faq${n}Q`)}<span className="landing-faq-chevron">⌄</span></button>
          {openFaq === n && <p>{t(`landing.faq${n}A`)}</p>}
        </div>)}
      </div>
    </section>
    <section className="landing-cta">
      <h2>{t('landing.ctaTitle')}</h2>
      <p>{t('landing.ctaSubtitle')}</p>
      <a className="primary" href={contactHref}>{t('landing.ctaButton')}</a>
    </section>
    <footer className="landing-footer">
      <span>{t('appName')}{t('appNamePro')} © {new Date().getFullYear()} — {t('landing.footerRights')}</span>
    </footer>
  </div>
}

const currencyKeys = ['BRL', 'USD', 'EUR']
const distanceUnitKeys = ['KM', 'MI']

function NewTenantModal({ onClose, onCreated }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ name: '', owner_name: '', owner_email: '', owner_password: '', plan: 'starter', currency: 'BRL', distance_unit: 'KM' })
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    const res = await apiFetch('/api/admin/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await res.json()
    if (!res.ok) return setError(data.error || '')
    onCreated()
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-head"><div><span className="eyebrow">{t('admin.title')}</span><h2>{t('admin.newWorkshop')}</h2></div><button type="button" onClick={onClose}>×</button></div>
    {error && <div className="login-error">{error}</div>}
    <div className="form-grid">
      <label>{t('admin.workshopName')}<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>{t('admin.ownerName')}<input required value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} /></label>
      <label>{t('login.email')}<input type="email" required value={form.owner_email} onChange={e => setForm({ ...form, owner_email: e.target.value })} /></label>
      <label>{t('login.password')}<input type="password" required value={form.owner_password} onChange={e => setForm({ ...form, owner_password: e.target.value })} /></label>
      <label>{t('admin.plan')}<select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>{planKeys.map(k => <option key={k} value={k}>{t(`admin.plan_${k}`)}</option>)}</select></label>
      <label>{t('settings.currency')}<select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{currencyKeys.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
      <label>{t('settings.distanceUnit')}<select value={form.distance_unit} onChange={e => setForm({ ...form, distance_unit: e.target.value })}>{distanceUnitKeys.map(k => <option key={k} value={k}>{t(`settings.distanceUnit_${k}`)}</option>)}</select></label>
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>{t('common.close')}</button><button className="primary">{t('admin.create')}</button></div>
  </form></div>
}

const planKeys = ['starter', 'pro', 'scale']
const subscriptionStatusKeys = ['trial', 'active', 'past_due', 'canceled']

function AdminTenantsPage({ user, onEnter, onLogout }) {
  const { t } = useTranslation()
  const [tenants, setTenants] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const load = useCallback(() => apiFetch('/api/admin/tenants').then(r => r.json()).then(setTenants).catch(() => {}), [])
  const loadMetrics = useCallback(() => apiFetch('/api/admin/metrics').then(r => r.json()).then(setMetrics).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadMetrics() }, [loadMetrics])
  const updateTenant = async (tenant, patch) => {
    const res = await apiFetch(`/api/admin/tenants/${tenant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (res.ok) { load(); loadMetrics() }
  }
  return <div className="login-screen admin-shell">
    <header className="admin-header">
      <div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div>
      <div><span>{user.name}</span><button type="button" className="text-btn" onClick={onLogout}>{t('settings.logout')}</button></div>
    </header>
    {metrics && <div className="admin-metrics">
      <Metric icon="⌂" label={t('admin.activeWorkshops')} value={String(metrics.active_workshops)} tone="green" />
      <Metric icon="⊘" label={t('admin.inactiveWorkshops')} value={String(metrics.inactive_workshops)} tone="coral" />
      <Metric icon="♙" label={t('admin.totalClients')} value={String(metrics.total_clients)} tone="blue" />
      <Metric icon="≈" label={t('admin.avgClientsPerWorkshop')} value={String(metrics.avg_clients_per_workshop)} tone="purple" />
      <Metric icon="▱" label={t('admin.totalVehicles')} value={String(metrics.total_vehicles)} tone="blue" />
      <Metric icon="👤" label={t('admin.totalUsers')} value={String(metrics.total_users)} tone="purple" />
      <Metric icon="◫" label={t('admin.openOrdersPlatform')} value={String(metrics.open_orders)} tone="amber" />
      <Metric icon="↗" label={t('admin.totalRevenue')} value={money(metrics.total_revenue) || t('dashboard.toDefine')} tone="green" />
    </div>}
    <div className="admin-content">
      <div className="admin-content-head"><h1>{t('admin.title')}</h1><button type="button" className="primary" onClick={() => setShowNew(true)}>{t('admin.newWorkshop')}</button></div>
      <table className="admin-table">
        <thead><tr><th>{t('admin.name')}</th><th>{t('admin.users')}</th><th>{t('admin.clients')}</th><th>{t('admin.plan')}</th><th>{t('admin.subscriptionStatus')}</th><th>{t('admin.status')}</th><th></th></tr></thead>
        <tbody>{tenants.map(tenant => <tr key={tenant.id}>
          <td>{tenant.name}</td><td>{tenant.user_count}</td><td>{tenant.client_count}</td>
          <td><select value={tenant.plan} onChange={e => updateTenant(tenant, { plan: e.target.value })}>{planKeys.map(k => <option key={k} value={k}>{t(`admin.plan_${k}`)}</option>)}</select></td>
          <td><select value={tenant.status} onChange={e => updateTenant(tenant, { status: e.target.value })}>{subscriptionStatusKeys.map(k => <option key={k} value={k}>{t(`admin.subscriptionStatus_${k}`)}</option>)}</select></td>
          <td><span className={`status ${tenant.active ? 'green' : 'coral'}`}>{tenant.active ? t('admin.active') : t('admin.inactive')}</span></td>
          <td>
            <button type="button" className="text-btn" onClick={() => onEnter(tenant)}>{t('admin.enter')}</button>
            <button type="button" className="text-btn" onClick={() => updateTenant(tenant, { active: tenant.active ? 0 : 1 })}>{tenant.active ? t('common.deactivate') : t('common.activate')}</button>
          </td>
        </tr>)}</tbody>
      </table>
      {!tenants.length && <p className="empty-hint">{t('admin.empty')}</p>}
    </div>
    {showNew && <NewTenantModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
  </div>
}

function PublicVehiclePage({ token }) {
  const { t } = useTranslation()
  const [data, setData] = useState(undefined)
  useEffect(() => { fetch(`${API}/public/vehicles/${token}`, { headers: { 'X-Lang': i18n.language } }).then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null)) }, [token])
  if (data === undefined) return <div className="login-screen"><p>{t('common.loading')}</p></div>
  if (!data) return <div className="login-screen"><div className="login-card"><h1>{t('publicPage.notFound')}</h1></div></div>
  const { vehicle, history } = data
  return <div className="landing public-page">
    <header className="landing-nav"><div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div></header>
    <section className="public-content">
      <span className="landing-badge">{t('publicPage.vehicleBadge')}</span>
      <h1>{vehicle.brand} {vehicle.model}{vehicle.version ? ` ${vehicle.version}` : ''}</h1>
      <p>{t('publicPage.vehicleGreeting', { name: vehicle.client_first_name || '' })}</p>
      <div className="vehicle-card" style={{ maxWidth: 420 }}><div className="car-icon">▱</div><div><strong>{vehicle.plate || '—'}{vehicle.year_model ? ` · ${vehicle.year_model}` : ''}</strong><span>{distance(vehicle.mileage)}</span></div></div>
      <h2 style={{ marginTop: 30 }}>{t('publicPage.historyTitle')}</h2>
      <div className="timeline">
        {history.map((event, i) => <div className="timeline-item" key={i}><span className="dot"></span><small>{new Date(event.created_at).toLocaleString('pt-BR')}</small><strong>{event.event_type}</strong><p>{event.description}</p>{event.mileage ? <em>{distance(event.mileage)}</em> : null}</div>)}
        {!history.length && <p className="empty-hint">{t('vehicles.noHistory')}</p>}
      </div>
    </section>
    <footer className="landing-footer"><span>{t('appName')}{t('appNamePro')} © {new Date().getFullYear()}</span></footer>
  </div>
}

function PublicOrderPage({ token }) {
  const { t } = useTranslation()
  const [data, setData] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [decision, setDecision] = useState('')
  const load = useCallback(() => fetch(`${API}/public/orders/${token}`, { headers: { 'X-Lang': i18n.language } }).then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null)), [token])
  useEffect(() => { load() }, [load])
  const decide = async (action) => {
    setBusy(true)
    const res = await fetch(`${API}/public/orders/${token}/${action}`, { method: 'POST', headers: { 'X-Lang': i18n.language } })
    const result = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) { setDecision(result.message); load() }
  }
  if (data === undefined) return <div className="login-screen"><p>{t('common.loading')}</p></div>
  if (!data) return <div className="login-screen"><div className="login-card"><h1>{t('publicPage.notFound')}</h1></div></div>
  return <div className="landing public-page">
    <header className="landing-nav"><div className="brand"><div className="brand-mark"><Icon name="wrench" size={16} /></div><span>{t('appName')}<span>{t('appNamePro')}</span></span></div></header>
    <section className="public-content">
      <span className="landing-badge">{data.number}</span>
      <h1>{t('publicPage.budgetTitle', { vehicle: data.vehicle })}</h1>
      <p>{t('publicPage.budgetGreeting', { name: data.client_first_name || '' })}</p>
      <div className="detail-section">
        {data.items.map(item => <div className="line-item" key={item.id}><span>{item.description}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span><b>{money(item.quantity * item.unit_price)}</b></div>)}
        <div className="total"><span>{t('orderDetail.totalExpected')}</span><strong>{money(data.total_amount)}</strong></div>
      </div>
      {decision ? <p className="landing-badge">{decision}</p> : data.awaiting ? <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="primary" disabled={busy} onClick={() => decide('approve')}>{t('publicPage.approve')}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => decide('reject')}>{t('publicPage.reject')}</button>
      </div> : <p className="empty-hint">{t('publicPage.alreadyDecided', { status: t(`status.${data.status}`, { defaultValue: data.status }) })}</p>}
    </section>
    <footer className="landing-footer"><span>{t('appName')}{t('appNamePro')} © {new Date().getFullYear()}</span></footer>
  </div>
}

export default function App() {
  const { t } = useTranslation()
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [actingTenant, setActingTenant] = useState(null)
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    handleUnauthorized = () => { setUser(null); setActingTenant(null) }
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return setAuthLoading(false)
    apiFetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(async data => {
      if (!data) { localStorage.removeItem(TOKEN_KEY); return }
      setUser(data)
      currentCurrency = data.tenant_currency || 'BRL'
      currentDistanceUnit = data.tenant_distance_unit || 'KM'
      const actingId = localStorage.getItem(ACTING_TENANT_KEY)
      if (actingId && data.role === 'super_admin') {
        const tenants = await apiFetch('/api/admin/tenants').then(r => r.json()).catch(() => [])
        const tenant = tenants.find(w => w.id === Number(actingId))
        if (tenant) { setActingTenant(tenant); currentCurrency = tenant.currency || 'BRL'; currentDistanceUnit = tenant.distance_unit || 'KM' }
      }
    }).finally(() => setAuthLoading(false))
  }, [])

  const handleLogin = (data) => { localStorage.setItem(TOKEN_KEY, data.token); setUser(data.user); currentCurrency = data.user.tenant_currency || 'BRL'; currentDistanceUnit = data.user.tenant_distance_unit || 'KM' }
  const handleLogout = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ACTING_TENANT_KEY); setUser(null); setActingTenant(null) }
  const enterTenant = (tenant) => { localStorage.setItem(ACTING_TENANT_KEY, String(tenant.id)); setActingTenant(tenant); currentCurrency = tenant.currency || 'BRL'; currentDistanceUnit = tenant.distance_unit || 'KM' }
  const exitTenant = () => { localStorage.removeItem(ACTING_TENANT_KEY); setActingTenant(null); currentCurrency = 'BRL'; currentDistanceUnit = 'KM' }

  const publicVehicleMatch = window.location.pathname.match(/^\/v\/([a-f0-9]+)$/)
  const publicOrderMatch = window.location.pathname.match(/^\/orcamento\/([a-f0-9]+)$/)
  if (publicVehicleMatch) return <PublicVehiclePage token={publicVehicleMatch[1]} />
  if (publicOrderMatch) return <PublicOrderPage token={publicOrderMatch[1]} />

  if (authLoading) return <div className="login-screen"><p>{t('common.loading')}</p></div>
  if (!user) return showLogin ? <LoginScreen onLogin={handleLogin} onBack={() => setShowLogin(false)} /> : <LandingPage onLogin={() => setShowLogin(true)} />
  if (user.role === 'super_admin' && !actingTenant) return <AdminTenantsPage user={user} onEnter={enterTenant} onLogout={handleLogout} />
  return <Workspace user={user} actingTenant={actingTenant} onLogout={handleLogout} onExitTenant={exitTenant} />
}
