import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from '../../lib/api'
import { MediaUploadButton } from '../components/MediaUploadButton'
import type { Service, ServiceCategory } from '../../types'
import toast from 'react-hot-toast'
import { ApiError } from '../../lib/api'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface ServiceForm {
  categoryId: string
  name: string
  description: string
  imageUrl: string
  durationMinutes: number
  bufferMinutes: number
  price: number
  resourceMode: 'STAFF_BASED' | 'POOLED'
  capacity: number
  assignedStaffIds: string[]
  discountType: '' | 'PERCENTAGE' | 'FLAT'
  discountValue: number
  discountLabel: string
  discountActive: boolean
  discountValidFrom: string
  discountValidUntil: string
}

const emptyServiceForm: ServiceForm = {
  categoryId: '',
  name: '',
  description: '',
  imageUrl: '',
  durationMinutes: 30,
  bufferMinutes: 0,
  price: 0,
  resourceMode: 'POOLED',
  capacity: 1,
  assignedStaffIds: [],
  discountType: '',
  discountValue: 0,
  discountLabel: '',
  discountActive: false,
  discountValidFrom: '',
  discountValidUntil: '',
}

export const ServicesPage: React.FC = () => {
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showCatForm, setShowCatForm] = useState(false)
  const [catName, setCatName] = useState('')
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [serviceForm, setServiceForm] = useState<ServiceForm>(emptyServiceForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hoursEditor, setHoursEditor] = useState<{ serviceId: string; name: string } | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [savingService, setSavingService] = useState(false)

  const load = useCallback(async () => {
    try {
      // Staff is an optional dependency on this page. The owner staff endpoint
      // correctly returns 403 when multi-staff is disabled; that must not hide
      // the independently available categories and services.
      const staffRequest = api.getStaff().catch((error) => {
        if (error instanceof ApiError && error.status === 403) return []
        throw error
      })
      const [cats, servs, staffList] = await Promise.all([api.getCategories(), api.getServices(), staffRequest])
      setCategories(cats)
      setServices(servs)
      setStaff(staffList.map((s) => ({ id: s.id, name: s.name })))
    } catch (e: any) {
      toast.error(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.createCategory({ name: catName })
      toast.success('Category created')
      setCatName('')
      setShowCatForm(false)
      load()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const toggleCategory = async (cat: ServiceCategory) => {
    await api.updateCategory(cat.id, { isActive: !cat.isActive })
    load()
  }

  const openServiceForm = (svc?: Service) => {
    if (svc) {
      setEditingId(svc.id)
      setServiceForm({
        categoryId: svc.categoryId,
        name: svc.name,
        description: svc.description || '',
        imageUrl: svc.imageUrl || '',
        durationMinutes: svc.durationMinutes,
        bufferMinutes: svc.bufferMinutes,
        price: svc.price,
        resourceMode: svc.resourceMode,
        capacity: svc.capacity,
        assignedStaffIds: svc.assignedStaffIds || [],
        discountType: svc.discountType || '',
        discountValue: svc.discountValue || 0,
        discountLabel: svc.discountLabel || '',
        discountActive: svc.discountActive,
        discountValidFrom: svc.discountValidFrom ? svc.discountValidFrom.slice(0, 10) : '',
        discountValidUntil: svc.discountValidUntil ? svc.discountValidUntil.slice(0, 10) : '',
      })
    } else {
      setEditingId(null)
      setServiceForm({ ...emptyServiceForm, categoryId: categories[0]?.id || '' })
    }
    setShowServiceForm(true)
  }

  const saveService = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingService(true)
    try {
      const payload = {
        ...serviceForm,
        discountType: serviceForm.discountType || null,
        discountValidFrom: serviceForm.discountValidFrom || null,
        discountValidUntil: serviceForm.discountValidUntil || null,
      }
      if (editingId) {
        await api.updateService(editingId, payload)
        toast.success('Service updated')
      } else {
        await api.createService(payload)
        toast.success('Service created')
      }
      setShowServiceForm(false)
      load()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save service')
    } finally {
      setSavingService(false)
    }
  }

  const toggleServiceActive = async (svc: Service) => {
    try {
      await api.updateService(svc.id, { isActive: !svc.isActive })
      load()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const deleteService = async (svc: Service) => {
    if (!window.confirm(`Delete "${svc.name}"? Bookings keep their snapshots.`)) return
    try {
      const res = await api.deleteService(svc.id)
      toast.success(res.softDeleted ? 'Service hidden (has past bookings)' : 'Service deleted')
      load()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const input = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'
  const label = 'block text-sm font-medium mb-1'
  const filteredServices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return services.filter((service) => {
      const matchesSearch = !query || service.name.toLowerCase().includes(query) || (service.description || '').toLowerCase().includes(query)
      const matchesCategory = categoryFilter === 'all' || service.categoryId === categoryFilter
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'active' ? service.isActive : !service.isActive)
      return matchesSearch && matchesCategory && matchesStatus
    })
  }, [services, search, categoryFilter, statusFilter])

  const activeCount = services.filter((service) => service.isActive).length
  const pooledCapacity = services
    .filter((service) => service.isActive && service.resourceMode === 'POOLED')
    .reduce((sum, service) => sum + service.capacity, 0)
  const formatPrice = (value: number) => new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-sm text-gray-500 mt-1">Build your bookable catalog, pricing, capacity, and availability.</p>
        </div>
        <button onClick={() => openServiceForm()} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold shadow-sm transition">
          <span className="text-lg leading-none">+</span> New service
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total services', value: services.length, icon: '✦' },
          { label: 'Active', value: activeCount, icon: '●' },
          { label: 'Categories', value: categories.filter((category) => category.isActive).length, icon: '▦' },
          { label: 'Pooled capacity', value: pooledCapacity, icon: '◎' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500">{stat.label}</p>
              <span className="text-primary">{stat.icon}</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search services..."
              className={`${input} pl-9`}
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'active', 'inactive'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition ${
                  statusFilter === status
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition ${
              categoryFilter === 'all' ? 'bg-primary text-white border-primary' : 'border-gray-200 dark:border-gray-700 hover:border-primary'
            }`}
          >
            All <span className="opacity-70 ml-1">{services.length}</span>
          </button>
          {categories.map((category) => {
            const count = services.filter((service) => service.categoryId === category.id).length
            return (
              <button
                key={category.id}
                onClick={() => setCategoryFilter(category.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm border transition ${
                  categoryFilter === category.id
                    ? 'bg-primary text-white border-primary'
                    : category.isActive
                      ? 'border-gray-200 dark:border-gray-700 hover:border-primary'
                      : 'border-gray-200 text-gray-400 opacity-60'
                }`}
              >
                {category.name} <span className="opacity-70 ml-1">{count}</span>
              </button>
            )
          })}
          <button onClick={() => setShowCatForm(!showCatForm)} className="shrink-0 px-3 py-1.5 rounded-full text-sm border border-dashed border-primary/50 text-primary hover:bg-primary/5">
            {showCatForm ? 'Cancel' : '+ Category'}
          </button>
        </div>

        {showCatForm && (
          <form onSubmit={saveCategory} className="flex gap-2 px-4 pb-4">
            <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Category name" required className={input} />
            <button type="submit" className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Add</button>
          </form>
        )}
      </div>

      {filteredServices.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl mx-auto mb-3">✦</div>
          <h3 className="font-semibold">{services.length === 0 ? 'Create your first service' : 'No matching services'}</h3>
          <p className="text-sm text-gray-500 mt-1">
            {services.length === 0 ? 'Add pricing, duration, capacity, and availability in one place.' : 'Try another search, category, or status.'}
          </p>
          {services.length === 0 && (
            <button onClick={() => openServiceForm()} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">Add service</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredServices.map((svc) => {
            const category = categories.find((item) => item.id === svc.categoryId)
            const capacity = svc.resourceMode === 'STAFF_BASED' ? svc.assignedStaffIds?.length || 0 : svc.capacity
            return (
              <article key={svc.id} className={`group bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:border-primary/40 hover:shadow-md transition ${!svc.isActive ? 'opacity-70' : ''}`}>
                <div className="flex">
                  <div className="w-28 sm:w-36 min-h-44 bg-gradient-to-br from-primary/15 to-primary/5 shrink-0 overflow-hidden">
                    {svc.imageUrl ? (
                      <img src={svc.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-4xl text-primary/60">✦</div>
                    )}
                  </div>
                  <div className="p-4 flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{svc.name}</h3>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${svc.isActive ? 'bg-emerald-500' : 'bg-gray-400'}`} title={svc.isActive ? 'Active' : 'Inactive'} />
                        </div>
                        <p className="text-xs text-primary font-medium mt-0.5">{category?.name || 'Uncategorized'}</p>
                      </div>
                      <p className="font-bold whitespace-nowrap">{formatPrice(svc.price)}</p>
                    </div>

                    {svc.description && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{svc.description}</p>}

                    <div className="flex flex-wrap gap-2 mt-3">
                      <span className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs">◷ {svc.durationMinutes} min</span>
                      {svc.bufferMinutes > 0 && <span className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs">+ {svc.bufferMinutes} min buffer</span>}
                      <span className="px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-xs">
                        {svc.resourceMode === 'STAFF_BASED' ? '♙' : '◎'} {capacity} {capacity === 1 ? 'seat' : 'seats'}
                      </span>
                    </div>

                    {svc.discountActive && svc.discountType && (
                      <div className="inline-flex mt-3 px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                        {svc.discountLabel || 'Offer'} · {svc.discountType === 'PERCENTAGE' ? `${svc.discountValue || 0}%` : formatPrice(svc.discountValue || 0)} off
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleServiceActive(svc)}
                    className="inline-flex items-center gap-2 h-8 text-xs font-medium text-gray-600 dark:text-gray-300"
                  >
                    <span
                      className={`relative inline-block w-9 h-5 shrink-0 rounded-full transition-colors ${svc.isActive ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-700'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 block w-4 h-4 bg-white rounded-full shadow transition-transform ${svc.isActive ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </span>
                    <span className="leading-none">{svc.isActive ? 'Live' : 'Hidden'}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setHoursEditor({ serviceId: svc.id, name: svc.name })} className="px-2.5 py-1.5 text-xs rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">Hours</button>
                    <button onClick={() => openServiceForm(svc)} className="px-2.5 py-1.5 text-xs font-medium text-primary rounded-md hover:bg-primary/10">Edit</button>
                    <button onClick={() => deleteService(svc)} className="px-2.5 py-1.5 text-xs text-red-600 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30" aria-label={`Delete ${svc.name}`}>Delete</button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>Category visibility:</span>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => toggleCategory(category)}
              className={`px-2 py-1 rounded-md border transition ${category.isActive ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-400' : 'border-gray-200 text-gray-400 dark:border-gray-700'}`}
              title={`Click to ${category.isActive ? 'hide' : 'show'} this category`}
            >
              {category.isActive ? '●' : '○'} {category.name}
            </button>
          ))}
        </div>
      )}

      {/* Service form modal */}
      {showServiceForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowServiceForm(false)
        }}>
          <form onSubmit={saveService} className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl p-6 space-y-5 my-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{editingId ? 'Edit service' : 'Create a service'}</h2>
                <p className="text-sm text-gray-500 mt-1">Configure what customers see and how many can book at once.</p>
              </div>
              <button type="button" onClick={() => setShowServiceForm(false)} className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={label}>Name *</label>
                <input value={serviceForm.name} onChange={(e) => setServiceForm(p => ({ ...p, name: e.target.value }))} required className={input} placeholder="e.g. Haircut & styling" autoFocus />
              </div>
              <div className="col-span-2">
                <label className={label}>Description</label>
                <textarea value={serviceForm.description} onChange={(e) => setServiceForm(p => ({ ...p, description: e.target.value }))} className={input} rows={3} placeholder="Tell customers what is included in this service." />
              </div>
              <div className="col-span-2">
                <label className={label}>Image URL</label>
                <div className="flex gap-2">
                  <input value={serviceForm.imageUrl} onChange={(e) => setServiceForm(p => ({ ...p, imageUrl: e.target.value }))} placeholder="https://..." className={input} />
                  <MediaUploadButton small onUploaded={(url) => setServiceForm(p => ({ ...p, imageUrl: url }))} label="⬆ Upload" />
                </div>
                {serviceForm.imageUrl && <img src={serviceForm.imageUrl} alt="Service preview" className="mt-2 w-16 h-16 rounded-lg object-cover" />}
              </div>
              <div className="col-span-2">
                <label className={label}>Category</label>
                <select value={serviceForm.categoryId} onChange={(e) => setServiceForm(p => ({ ...p, categoryId: e.target.value }))} className={input}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Duration (min) *</label>
                <input type="number" min={5} value={serviceForm.durationMinutes} onChange={(e) => setServiceForm(p => ({ ...p, durationMinutes: parseInt(e.target.value) || 30 }))} className={input} />
              </div>
              <div>
                <label className={label}>Buffer (min)</label>
                <input type="number" min={0} value={serviceForm.bufferMinutes} onChange={(e) => setServiceForm(p => ({ ...p, bufferMinutes: parseInt(e.target.value) || 0 }))} className={input} />
              </div>
              <div>
                <label className={label}>Price (₹) *</label>
                <input type="number" min={0} step="0.01" value={serviceForm.price} onChange={(e) => setServiceForm(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))} className={input} />
              </div>
              <div className="col-span-2">
                <label className={label}>How is capacity managed?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setServiceForm((previous) => ({ ...previous, resourceMode: 'POOLED' }))}
                    className={`p-3 rounded-xl border text-left transition ${serviceForm.resourceMode === 'POOLED' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'}`}
                  >
                    <span className="font-medium text-sm">◎ Shared capacity</span>
                    <span className="block text-xs text-gray-500 mt-1">Set a fixed number of parallel customer seats.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceForm((previous) => ({ ...previous, resourceMode: 'STAFF_BASED' }))}
                    className={`p-3 rounded-xl border text-left transition ${serviceForm.resourceMode === 'STAFF_BASED' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'}`}
                  >
                    <span className="font-medium text-sm">♙ Assigned staff</span>
                    <span className="block text-xs text-gray-500 mt-1">Each available staff member provides one seat.</span>
                  </button>
                </div>
              </div>
              {serviceForm.resourceMode === 'POOLED' && (
                <div className="col-span-2">
                  <label className={label}>Capacity (parallel customers)</label>
                  <input type="number" min={1} value={serviceForm.capacity} onChange={(e) => setServiceForm(p => ({ ...p, capacity: parseInt(e.target.value) || 1 }))} className={input} />
                  <p className="text-xs text-gray-500 mt-1">Customers will see up to {serviceForm.capacity} available {serviceForm.capacity === 1 ? 'seat' : 'seats'} for each time slot.</p>
                </div>
              )}
              {serviceForm.resourceMode === 'STAFF_BASED' && (
                <div className="col-span-2">
                  <label className={label}>Assigned Staff</label>
                  <div className="space-y-1.5">
                    {staff.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={serviceForm.assignedStaffIds.includes(s.id)}
                          onChange={(e) => setServiceForm(p => ({
                            ...p,
                            assignedStaffIds: e.target.checked ? [...p.assignedStaffIds, s.id] : p.assignedStaffIds.filter((x) => x !== s.id),
                          }))}
                          className="rounded border-gray-300" />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="col-span-2 border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
                <div className="flex items-center gap-2 mb-3">
                  <input type="checkbox" checked={serviceForm.discountActive} onChange={(e) => setServiceForm(p => ({ ...p, discountActive: e.target.checked }))} className="rounded border-gray-300" />
                  <label className="text-sm font-medium">Enable discount / offer</label>
                </div>
                {serviceForm.discountActive && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={label}>Type</label>
                      <select value={serviceForm.discountType} onChange={(e) => setServiceForm(p => ({ ...p, discountType: e.target.value as any }))} className={input}>
                        <option value="">None</option>
                        <option value="PERCENTAGE">Percentage</option>
                        <option value="FLAT">Flat amount</option>
                      </select>
                    </div>
                    <div>
                      <label className={label}>Value</label>
                      <input type="number" min={0} value={serviceForm.discountValue} onChange={(e) => setServiceForm(p => ({ ...p, discountValue: parseFloat(e.target.value) || 0 }))} className={input} />
                    </div>
                    <div>
                      <label className={label}>Label (e.g. Festive Offer)</label>
                      <input value={serviceForm.discountLabel} onChange={(e) => setServiceForm(p => ({ ...p, discountLabel: e.target.value }))} className={input} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={label}>Valid From</label>
                        <input type="date" value={serviceForm.discountValidFrom} onChange={(e) => setServiceForm(p => ({ ...p, discountValidFrom: e.target.value }))} className={input} />
                      </div>
                      <div>
                        <label className={label}>Valid Until</label>
                        <input type="date" value={serviceForm.discountValidUntil} onChange={(e) => setServiceForm(p => ({ ...p, discountValidUntil: e.target.value }))} className={input} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowServiceForm(false)} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={savingService} className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {savingService ? 'Saving...' : editingId ? 'Save changes' : 'Create service'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Service hours editor */}
      {hoursEditor && <ServiceHoursEditor serviceId={hoursEditor.serviceId} serviceName={hoursEditor.name} onClose={() => setHoursEditor(null)} />}
    </div>
  )
}

function ServiceHoursEditor({ serviceId, serviceName, onClose }: { serviceId: string; serviceName: string; onClose: () => void }) {
  const [hours, setHours] = useState<{ dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean; isOverride?: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    api.getServiceHours(serviceId).then((existing) => {
      if (existing.length > 0) {
        setEnabled(true)
        const map = new Map(existing.map((h) => [h.dayOfWeek, h]))
        setHours(DAYS.map((_, i) => ({
          dayOfWeek: i,
          openTime: map.get(i)?.openTime || '09:00',
          closeTime: map.get(i)?.closeTime || '18:00',
          isOpen: map.get(i)?.isOpen ?? true,
          isOverride: !!map.get(i),
        })))
      } else {
        setHours(DAYS.map((_, i) => ({ dayOfWeek: i, openTime: '09:00', closeTime: '18:00', isOpen: true })))
      }
    }).catch(() => toast.error('Failed to load hours'))
  }, [serviceId])

  const save = async () => {
    setSaving(true)
    try {
      await api.updateServiceHours(serviceId, enabled ? hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime, isOpen: h.isOpen })) : [])
      toast.success('Service hours saved')
      onClose()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-lg p-6 space-y-4 my-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hours for {serviceName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <p className="text-sm text-gray-500">When disabled, this service uses the business hours. Enable to override per day.</p>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-gray-300" />
          Override business hours
        </label>
        {enabled && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {hours.map((h) => (
              <div key={h.dayOfWeek} className="flex items-center gap-2 text-sm">
                <span className="w-24">{DAYS[h.dayOfWeek]}</span>
                <input type="time" value={h.openTime} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, openTime: e.target.value } : x))}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm" />
                <span>-</span>
                <input type="time" value={h.closeTime} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, closeTime: e.target.value } : x))}
                  className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm" />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={h.isOpen} onChange={(e) => setHours(hours.map((x) => x.dayOfWeek === h.dayOfWeek ? { ...x, isOpen: e.target.checked } : x))} className="rounded" />
                  Open
                </label>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Hours'}
          </button>
        </div>
      </div>
    </div>
  )
}
