import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

function calcKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return +(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);
}

async function geocodePlace(street, postcode, town, country) {
  const host = 'https://openstreetmap.org';
  const cleanPin = (postcode || '').trim().toUpperCase().replace(/\s+/g, '');
  const spacedPin =
    cleanPin.length > 4
      ? `${cleanPin.slice(0, -3)} ${cleanPin.slice(-3)}`
      : cleanPin;
  const countryName = country === 'UK' ? 'United Kingdom' : 'Ireland';
  const cc = country === 'UK' ? 'gb' : 'ie';
  const queries = [
    spacedPin ? `${spacedPin}, ${countryName}` : '',
    `${street}, ${town}, ${countryName}`,
    `${town}, ${countryName}`,
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const res = await fetch(
        `${host}/search?format=json&limit=1&countrycodes=${cc}&q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      const hit = Array.isArray(data) ? data.find(Boolean) : null;
      if (hit) return { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) };
    } catch (_) {}
  }
  return null;
}

function playConfirmChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523.25, 659.25, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
      gain.gain.setValueAtTime(0.22, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.32);
    });
  } catch (_) {}
}

const DEFAULT_SETTINGS = {
  country: 'IE',
  customerName: '',
  customerPhone: '',
  doorNumber: '',
  streetRoad: '',
  postcode: '',
  townCounty: 'Dundalk, Co. Louth',
  customerPhoto: '',
  soundEnabled: true,
};

export default function App() {
  const [tab, setTab] = useState('order');
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('swiftbuy_customer_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch (_) {
      return DEFAULT_SETTINGS;
    }
  });
  const [savedBanner, setSavedBanner] = useState(false);
  const [orders, setOrders] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);

  const [form, setForm] = useState(() => ({
    country: settings.country,
    customerName: settings.customerName,
    customerPhone: settings.customerPhone,
    storeName: '',
    itemsList: '',
    estimatedGoodsCost: '',
    deliveryFee: '5.00',
    tipAmount: '2.00',
    doorNumber: settings.doorNumber,
    streetRoad: settings.streetRoad,
    postcode: settings.postcode,
    townCounty: settings.townCounty,
  }));

  const curr = form.country === 'UK' ? '£' : '€';

  const loadOrders = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setOrders(data);
  };

  useEffect(() => {
    loadOrders();
    const timer = setInterval(loadOrders, 10000);
    return () => clearInterval(timer);
  }, []);

  const handlePhotoUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 250;
        const scale = Math.min(max / img.width, max / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        setSettings((prev) => ({
          ...prev,
          customerPhoto: canvas.toDataURL('image/jpeg', 0.8),
        }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const saveSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('swiftbuy_customer_settings', JSON.stringify(settings));
    setForm((prev) => ({
      ...prev,
      country: settings.country,
      customerName: settings.customerName,
      customerPhone: settings.customerPhone,
      doorNumber: settings.doorNumber,
      streetRoad: settings.streetRoad,
      postcode: settings.postcode,
      townCounty: settings.townCounty,
    }));
    if (settings.soundEnabled) playConfirmChime();
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  const clearSettings = () => {
    localStorage.removeItem('swiftbuy_customer_settings');
    setSettings(DEFAULT_SETTINGS);
    setForm((prev) => ({ ...prev, ...DEFAULT_SETTINGS }));
  };

  const placeOrder = async (e) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !form.storeName || !form.itemsList || !form.streetRoad || !form.townCounty) {
      return alert('Please fill in Store, Items, Name, Phone, Street, and Town/County.');
    }
    setSubmitting(true);
    const dropCoords = await geocodePlace(form.streetRoad, form.postcode, form.townCounty, form.country);
    if (!dropCoords) {
      setSubmitting(false);
      return alert('Address or Postcode/Eircode not found. Please verify your town & postcode.');
    }
    const storeCoords = (await geocodePlace(form.storeName, '', form.townCounty, form.country)) || dropCoords;
    const dist = calcKm(storeCoords.lat, storeCoords.lng, dropCoords.lat, dropCoords.lng);
    if (dist > 7) {
      setSubmitting(false);
      return alert(`Store to delivery address is ${dist} km (maximum allowed is 7 km).`);
    }

    const id = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const tip = parseFloat(form.tipAmount || '0');
    const fee = parseFloat(form.deliveryFee || '5') + tip;

    const payload = {
      id,
      customer_name: form.customerName.trim(),
      customer_phone: form.customerPhone.trim(),
      store_name: form.storeName.trim(),
      items_list: form.itemsList.trim(),
      estimated_goods_cost: parseFloat(form.estimatedGoodsCost || '0'),
      delivery_fee: fee,
      tip_amount: tip,
      vehicle: 'Any Vehicle',
      door_number: form.doorNumber.trim(),
      street_road: form.streetRoad.trim(),
      postcode: form.postcode.trim().toUpperCase(),
      region: form.country === 'UK' ? 'UK' : form.townCounty.trim(),
      lat: dropCoords.lat,
      lng: dropCoords.lng,
      status: 'pending',
      payout_status: 'unpaid',
      distance_km: dist,
    };
    if (settings.customerPhoto) payload.customer_photo = settings.customerPhoto;

    const { error } = await supabase.from('orders').insert(payload);
    setSubmitting(false);
    if (error) return alert('Error: ' + error.message);

    if (settings.soundEnabled) playConfirmChime();
    setLastOrder({ id, dist, tip, curr });
    setForm({ ...form, storeName: '', itemsList: '', estimatedGoodsCost: '' });
    loadOrders();
  };

  const myOrders = settings.customerPhone.trim()
    ? orders.filter((o) => (o.customer_phone || '').includes(settings.customerPhone.trim()))
    : orders.slice(0, 6);

  const card = { background: '#161f33', border: '1px solid #26324d', borderRadius: 14, padding: 16, marginBottom: 14 };
  const input = { width: '100%', boxSizing: 'border-box', background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, padding: '11px 12px', color: '#f8fafc', fontSize: 14, marginBottom: 10 };
  const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer' });

  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: '14px 14px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>SwiftBuy</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('order')} style={btn(tab === 'order' ? '#10b981' : '#1e293b')}>+ Order</button>
          <button onClick={() => setTab('orders')} style={btn(tab === 'orders' ? '#2563eb' : '#1e293b')}>My Orders</button>
          <button onClick={() => setTab('settings')} style={btn(tab === 'settings' ? '#8b5cf6' : '#1e293b')}>⚙ Settings</button>
        </div>
      </div>

      {tab === 'order' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Place a Delivery Order</h2>
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value, townCounty: e.target.value === 'UK' ? 'Newry, Co. Down' : 'Dundalk, Co. Louth' })} style={{ background: '#0b1120', color: '#f8fafc', border: '1px solid #2b3856', borderRadius: 8, padding: '6px 8px', fontSize: 12 }}>
              <option value="IE">🇮🇪 IE (€)</option>
              <option value="UK">🇬🇧 UK (£)</option>
            </select>
          </div>
          {lastOrder && <div style={{ background: '#064e3b', border: '1px solid #10b981', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 13 }}>✅ Order <b>{lastOrder.id}</b> placed! ({lastOrder.dist} km)</div>}
          <form onSubmit={placeOrder}>
            <input style={input} placeholder="Store Name * (e.g. Tesco, Dunnes, Lidl)" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} />
            <textarea style={{ ...input, minHeight: 74, resize: 'vertical' }} placeholder="Shopping List / Items *" value={form.itemsList} onChange={(e) => setForm({ ...form, itemsList: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} type="number" step="0.01" placeholder={`Est. Goods (${curr})`} value={form.estimatedGoodsCost} onChange={(e) => setForm({ ...form, estimatedGoodsCost: e.target.value })} />
              <input style={input} type="number" step="0.50" placeholder={`Tip (${curr})`} value={form.tipAmount} onChange={(e) => setForm({ ...form, tipAmount: e.target.value })} />
            </div>
            <input style={input} placeholder="Your Full Name *" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            <input style={input} placeholder="Mobile Phone *" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...input, width: '32%' }} placeholder="Door/Apt" value={form.doorNumber} onChange={(e) => setForm({ ...form, doorNumber: e.target.value })} />
              <input style={input} placeholder="Street / Road *" value={form.streetRoad} onChange={(e) => setForm({ ...form, streetRoad: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder={form.country === 'UK' ? 'UK Postcode (e.g. BT35 6AA)' : 'Eircode (e.g. A91 P592)'} value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
              <input style={input} placeholder="Town & County *" value={form.townCounty} onChange={(e) => setForm({ ...form, townCounty: e.target.value })} />
            </div>
            <button disabled={submitting} type="submit" style={{ ...btn('#10b981'), width: '100%', padding: 13, fontSize: 15 }}>
              {submitting ? 'Calculating Exact GPS Distance...' : `Submit Order (${curr}${(Number(form.deliveryFee || 0) + Number(form.tipAmount || 0)).toFixed(2)} Fee+Tip)`}
            </button>
          </form>
        </div>
      )}

      {tab === 'orders' && (
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>{settings.customerPhone ? `Orders for ${settings.customerPhone}` : 'Recent Orders'}</h3>
          {myOrders.map((o) => (
            <div key={o.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <b style={{ fontSize: 15 }}>{o.store_name}</b>
                <span style={{ color: o.status === 'delivered' ? '#10b981' : '#38bdf8', fontWeight: 700, fontSize: 13 }}>{o.status}</span>
              </div>
              <div style={{ fontSize: 13, marginBottom: 6 }}>{o.items_list}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>{o.id} • {o.door_number} {o.street_road}, {o.postcode}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <div style={card}>
          <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Customer Settings</h2>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: '#9ca3af' }}>Save your default delivery address and profile photo so every order fills in automatically.</p>
          {savedBanner && <div style={{ background: '#064e3b', border: '1px solid #10b981', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 13 }}>✅ Settings saved!</div>}
          <form onSubmit={saveSettings}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, background: '#0b1120', padding: 10, borderRadius: 10, border: '1px solid #2b3856' }}>
              {settings.customerPhoto ? <img src={settings.customerPhoto} alt="Profile" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid #10b981' }} /> : <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👤</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Profile Photo (Shown to Driver)</div>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: 12, color: '#9ca3af' }} />
              </div>
            </div>
            <select style={input} value={settings.country} onChange={(e) => setSettings({ ...settings, country: e.target.value, townCounty: e.target.value === 'UK' ? 'Newry, Co. Down' : 'Dundalk, Co. Louth' })}>
              <option value="IE">🇮🇪 Ireland (€ EUR)</option>
              <option value="UK">🇬🇧 Northern Ireland / UK (£ GBP)</option>
            </select>
            <input style={input} placeholder="Default Full Name" value={settings.customerName} onChange={(e) => setSettings({ ...settings, customerName: e.target.value })} />
            <input style={input} placeholder="Default Mobile Phone" value={settings.customerPhone} onChange={(e) => setSettings({ ...settings, customerPhone: e.target.value })} />
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...input, width: '32%' }} placeholder="Door/Apt" value={settings.doorNumber} onChange={(e) => setSettings({ ...settings, doorNumber: e.target.value })} />
              <input style={input} placeholder="Default Street / Road" value={settings.streetRoad} onChange={(e) => setSettings({ ...settings, streetRoad: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder={settings.country === 'UK' ? 'UK Postcode (e.g. BT35 6AA)' : 'Eircode (e.g. A91 P592)'} value={settings.postcode} onChange={(e) => setSettings({ ...settings, postcode: e.target.value })} />
              <input style={input} placeholder="Default Town & County" value={settings.townCounty} onChange={(e) => setSettings({ ...settings, townCounty: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, padding: '11px 12px', marginBottom: 14, fontSize: 13 }}>
              <span>🔔 Order Confirmation Sound Chimes</span>
              <input type="checkbox" checked={settings.soundEnabled} onChange={(e) => setSettings({ ...settings, soundEnabled: e.target.checked })} />
            </label>
            <button type="submit" style={{ ...btn('#10b981'), width: '100%', padding: 12, fontSize: 14, marginBottom: 10 }}>Save Customer Settings</button>
            <button type="button" onClick={clearSettings} style={{ ...btn('#334155'), width: '100%', padding: 10, fontSize: 13 }}>Reset Saved Data</button>
          </form>
        </div>
      )}
    </div>
  );
}
