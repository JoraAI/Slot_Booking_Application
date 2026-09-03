import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import toast from 'react-hot-toast'
import type { Product, ProductSale } from '../../types'

const iso = (d: Date) => d.toISOString().slice(0, 10)

export const ProductsPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<ProductSale[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState({ name: '', sku: '', price: '', cost: '' })
  const [saleModal, setSaleModal] = useState<{ productId: string; quantity: string; note: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saleFrom, setSaleFrom] = useState(searchParams.get('dateFrom') || iso(new Date(Date.now() - 30 * 86400000)))
  const [saleTo, setSaleTo] = useState(searchParams.get('dateTo') || iso(new Date()))

  const loadProducts = () => {
    api.getProducts().then(setProducts).catch(() => toast.error('Could not load products'))
  }

  const loadSales = () => {
    api.getProductSales({ dateFrom: saleFrom, dateTo: saleTo })
      .then(setSales)
      .catch(() => setSales([]))
  }

  useEffect(() => {
    Promise.all([api.getProducts(), api.getProductSales({ dateFrom: saleFrom, dateTo: saleTo })])
      .then(([p, s]) => { setProducts(p); setSales(s) })
      .catch(() => toast.error('Could not load products'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (loading) return
    loadSales()
  }, [saleFrom, saleTo])

  const startAdd = () => { setEditing(null); setForm({ name: '', sku: '', price: '', cost: '' }); setShowForm(true) }
  const startEdit = (p: Product) => {
    setEditing(p)
    setForm({ name: p.name, sku: p.sku || '', price: String(p.price), cost: p.cost != null ? String(p.cost) : '' })
    setShowForm(true)
  }

  const saveProduct = async () => {
    const price = Number(form.price)
    if (!form.name.trim() || !Number.isFinite(price) || price < 0) {
      toast.error('Name and a valid price are required')
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        name: form.name.trim(),
        price,
        sku: form.sku.trim() === '' ? null : form.sku.trim(),
        cost: form.cost.trim() === '' ? null : Number(form.cost),
      }
      if (editing) await api.updateProduct(editing.id, payload)
      else await api.createProduct(payload)
      toast.success(editing ? 'Product updated' : 'Product added')
      setShowForm(false)
      loadProducts()
    } catch (err: any) {
      toast.error(err.message || 'Could not save product')
    } finally {
      setSaving(false)
    }
  }

  const deactivate = async (p: Product) => {
    if (!window.confirm(`Deactivate ${p.name}? Sales history is kept.`)) return
    try {
      await api.deactivateProduct(p.id)
      loadProducts()
      toast.success('Product deactivated')
    } catch (err: any) {
      toast.error(err.message || 'Could not deactivate')
    }
  }

  const markSale = async () => {
    if (!saleModal) return
    const quantity = Number(saleModal.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error('Enter a quantity of at least 1')
      return
    }
    setSaving(true)
    try {
      await api.markProductSale({
        productId: saleModal.productId,
        quantity,
        note: saleModal.note.trim() === '' ? null : saleModal.note.trim(),
      })
      toast.success('Sale recorded')
      setSaleModal(null)
      loadSales()
    } catch (err: any) {
      toast.error(err.message || 'Could not record sale')
    } finally {
      setSaving(false)
    }
  }

  const openSale = (p: Product) => setSaleModal({ productId: p.id, quantity: '1', note: '' })
  const inputCls = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800'

  const ProductActions = ({ p, stacked }: { p: Product; stacked?: boolean }) => (
    <div className={stacked ? 'flex flex-col gap-2' : 'flex flex-wrap gap-1.5 justify-end'}>
      {p.isActive && (
        <button onClick={() => openSale(p)} className={`${stacked ? 'w-full py-2.5' : 'text-xs px-2 py-1'} bg-primary text-white rounded-lg hover:opacity-90 font-medium`}>
          Mark sale
        </button>
      )}
      <div className={stacked ? 'flex gap-2' : 'contents'}>
        <button onClick={() => startEdit(p)} className={`${stacked ? 'flex-1 py-2' : 'text-xs px-2 py-1'} border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800`}>
          Edit
        </button>
        {p.isActive && (
          <button onClick={() => void deactivate(p)} className={`${stacked ? 'flex-1 py-2' : 'text-xs px-2 py-1'} border border-red-200 text-red-600 rounded-lg hover:bg-red-50`}>
            Deactivate
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-sm text-gray-500 mt-1">Retail items you sell at the salon (owner-only — no public storefront).</p>
        </div>
        <button onClick={startAdd} className="w-full sm:w-auto px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark">
          + Add Product
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4 w-full max-w-lg">
          <h2 className="text-lg font-semibold">{editing ? `Edit ${editing.name}` : 'Add product'}</h2>
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className={inputCls} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Price (₹) *</label>
              <input type="number" min={0} step={0.01} value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Cost (₹)</label>
              <input type="number" min={0} step={0.01} value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">SKU</label>
              <input value={form.sku} onChange={(e) => setForm((p) => ({ ...p, sku: e.target.value }))} className={inputCls} />
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button onClick={() => setShowForm(false)} className="w-full sm:w-auto px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
            <button onClick={() => void saveProduct()} disabled={saving} className="w-full sm:w-auto px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold">Catalog</h2>
        </div>
        {loading ? (
          <p className="p-6 text-gray-400 text-sm">Loading...</p>
        ) : products.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No products yet. Add your first retail item above.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">SKU</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Price</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Cost</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-gray-500">{p.sku || '—'}</td>
                      <td className="px-4 py-3">₹{p.price.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3 text-gray-500">{p.cost != null ? `₹${p.cost.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td className="px-4 py-3"><ProductActions p={p} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
              {products.map((p) => (
                <div key={p.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-sm text-gray-500">₹{p.price.toLocaleString('en-IN')}{p.sku ? ` · ${p.sku}` : ''}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <ProductActions p={p} stacked />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Sales history</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm w-full sm:w-auto">
            <input type="date" value={saleFrom} onChange={(e) => setSaleFrom(e.target.value)} className="w-full sm:w-auto px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800" />
            <span className="hidden sm:inline text-xs text-gray-400">→</span>
            <input type="date" value={saleTo} onChange={(e) => setSaleTo(e.target.value)} className="w-full sm:w-auto px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800" />
            <button onClick={loadSales} className="w-full sm:w-auto px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Apply</button>
          </div>
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-gray-400">No sales in this range.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Product</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Qty</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Total</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Note</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-medium">{s.product?.name || '—'}</td>
                      <td className="px-4 py-2">{s.quantity}</td>
                      <td className="px-4 py-2">₹{s.totalAmount.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-2 text-gray-500">{s.note || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{new Date(s.soldAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-3">
              {sales.map((s) => (
                <div key={s.id} className="border border-gray-200 dark:border-gray-800 rounded-xl p-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{s.product?.name || '—'}</p>
                    <p className="font-semibold shrink-0">₹{s.totalAmount.toLocaleString('en-IN')}</p>
                  </div>
                  <p className="text-xs text-gray-500">Qty {s.quantity} · {new Date(s.soldAt).toLocaleString()}</p>
                  {s.note && <p className="text-xs text-gray-500">{s.note}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {saleModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center overflow-y-auto p-0 sm:p-4">
          <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-xl border border-gray-200 dark:border-gray-800 shadow-xl w-full max-w-sm p-5 sm:p-6 space-y-4 sm:my-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Mark sale</h2>
              <button onClick={() => setSaleModal(null)} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
            </div>
            <p className="text-sm text-gray-500">{products.find((p) => p.id === saleModal.productId)?.name}</p>
            <div>
              <label className="block text-sm font-medium mb-1">Quantity</label>
              <input type="number" min={1} value={saleModal.quantity} onChange={(e) => setSaleModal((p) => p ? { ...p, quantity: e.target.value } : p)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Note (optional)</label>
              <input value={saleModal.note} onChange={(e) => setSaleModal((p) => p ? { ...p, note: e.target.value } : p)} placeholder="e.g. walk-in, retail" className={inputCls} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button onClick={() => setSaleModal(null)} className="w-full sm:w-auto px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => void markSale()} disabled={saving} className="w-full sm:flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Saving...' : 'Record sale'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
