import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

const SHOPS = [
  { id: 'Tesco', label: '🛒 Tesco', tag: 'Supermarket' },
  { id: 'Dunnes Stores', label: '🛍️ Dunnes', tag: 'Groceries' },
  { id: 'Aldi', label: '🥦 Aldi', tag: 'Value' },
  { id: 'Lidl', label: '🥖 Lidl', tag: 'Fresh' },
  { id: 'Custom', label: '🏪 Other Shop', tag: 'Any Store' },
];

const QUICK_GROCERIES = [
  '🥛 Fresh Milk (2L)',
  '🍞 Sliced Bread',
  '🥚 Free Range Eggs (12)',
  '🍌 Bananas (Bunch)',
  '🍗 Chicken Fillets',
  '🧀 Cheddar Cheese',
  '🥔 Potatoes (2.5kg)',
  '🍎 Apples (6 Pack)',
  '☕ Tea Bags / Coffee',
  '💧 Still Water (6 Pack)',
  '🍝 Pasta & Sauce',
  '🧻 Kitchen Roll',
];

const PAY_OPTIONS = [
  { id: 'Card', label: '💳 Card' },
  { id: 'Revolut', label: '📱 Revolut' },
];

const TIP_PRESETS = ['0', '2', '5', '10'];

async function searchAddressSuggestions(query, country) {
  if (!query || query.trim().length < 3) return [];
  const bias = country === 'UK' ? 'United Kingdom' : 'Ireland';
  try {
    const res = await fetch(
      `https://komoot.io{encodeURIComponent(query + ', ' + bias)}&limit=5`
    );
    const data = await res.json();
    return (data.features || []).map((f) => {
      const pr = f.properties || {};
      const street = [pr.housenumber, pr.street || pr.name].filter(Boolean).join(' ');
      const town = [pr.city || pr.town || pr.village || pr.suburb, pr.county || pr.state].filter(Boolean).join(', ');
      const postcode = pr.postcode || '';
      const label = [street, town, postcode].filter(Boolean).join(', ');
      return {
        label: label || pr.name || query,
        street: street || pr.name || '',
        town: town || '',
        postcode,
        lat: f.geometry?.coordinates?.[1],
        lng: f.geometry?.coordinates?.[0],
      };
    });
  } catch {
    return [];
  }
}

function calcKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

async function geocodePlace(street, postcode, town, country) {
  const queries = [
    [street, postcode, town, country].filter(Boolean).join(', '),
    [postcode, town, country].filter(Boolean).join(', '),
    [town, country].filter(Boolean).join(', '),
  ];
  for (const q of queries) {
    if (!q.trim()) continue;
    try {
      const res = await fetch(
        `https://openstreetmap.org{encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (data && data) {
        return { lat: parseFloat(data.lat), lng: parseFloat(data.lon) };
      }
    } catch {}
  }
  return null;
}

function playConfirmChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

function getVehicleBadge(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('bike') && !s.includes('motor')) return { emoji: '🚴', label: 'Bicycle' };
  if (s.includes('bicycle') || s.includes('cycle')) return { emoji: '🚴', label: 'Bicycle' };
  if (s.includes('motor') || s.includes('scooter') || s.includes('moped'))
    return { emoji: '🏍️', label: 'Motorcycle' };
  return { emoji: '🚗', label: 'Car' };
}

function LiveDriverMap({ driver }) {
  const mapElRef = useRef(null);
  const mapObjRef = useRef(null);
  const driverMarkerRef = useRef(null);

  const lat = typeof driver?.lat === 'number' ? driver.lat : 54.0037;
  const lng = typeof driver?.lng === 'number' ? driver.lng : -6.4021;
  const badge = getVehicleBadge(driver?.vehicle_type || driver?.vehicle);

  useEffect(() => {
    if (!mapElRef.current || !window.L || mapObjRef.current) return;
    const L = window.L;
    const map = L.map(mapElRef.current, { zoomControl: false }).setView([lat, lng], 15);
    L.tileLayer('https://{s}://{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    mapObjRef.current = map;
    return () => {
      try { map.remove(); } catch {}
      mapObjRef.current = null;
      driverMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapObjRef.current;
    const L = window.L;
    if (!map || !L) return;
    const icon = L.divIcon({
      className: 'sb-driver-pin',
      html: `<div style="background:#0f172a;border:2px solid #10b981;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:0 0 14px rgba(16,185,129,0.75);">${badge.emoji}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.marker([lat, lng], { icon }).addTo(map);
    } else {
      driverMarkerRef.current.setLatLng([lat, lng]);
      driverMarkerRef.current.setIcon(icon);
    }
    map.panTo([lat, lng]);
  }, [lat, lng, badge.emoji]);

  return (
    <div style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', border: '1px solid #2b3856' }}>
      <div style={{ background: '#0b1120', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
        <span style={{ color: '#10b981', fontWeight: 700 }}>{badge.emoji} Driver Live ({badge.label})</span>
        <span style={{ color: '#94a3b8' }}>{driver?.name ? driver.name : 'On the move'} • Live GPS</span>
      </div>
      <div ref={mapElRef} style={{ width: '100%', height: 185, background: '#0f172a' }} />
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authMsg, setAuthMsg] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [tab, setTab] = useState('order');
  const [savedBanner, setSavedBanner] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [driversMap, setDriversMap] = useState({});
  const [ratings, setRatings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('swiftbuy_order_ratings') || '{}'); } catch { return {}; }
  });
  const [ratingDrafts, setRatingDrafts] = useState({});
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('swiftbuy_customer_settings') || '{}');
      return {
        country: saved.country || 'IE', customerName: saved.customerName || '',
        customerPhone: saved.customerPhone || '', customerPhoto: saved.customerPhoto || '',
        doorNumber: saved.doorNumber || '', streetRoad: saved.streetRoad || '',
        postcode: saved.postcode || '', townCounty: saved.townCounty || 'Dundalk, Co. Louth',
        paymentMethod: saved.paymentMethod === 'Revolut' ? 'Revolut' : 'Card',
        soundEnabled: saved.soundEnabled !== false,
      };
    } catch {
      return {
        country: 'IE', customerName: '', customerPhone: '', customerPhoto: '',
        doorNumber: '', streetRoad: '', postcode: '', townCounty: 'Dundalk, Co. Louth',
        paymentMethod: 'Card', soundEnabled: true,
      };
    }
  });
  const [selectedShop, setSelectedShop] = useState('Tesco');
  const [customShopName, setCustomShopName] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [form, setForm] = useState({
    country: settings.country, customerName: settings.customerName, customerPhone: settings.customerPhone,
    storeName: 'Tesco', itemsList: '', estimatedGoodsCost: '', deliveryFee: '5.00', tipAmount: '2',
    doorNumber: settings.doorNumber, streetRoad: settings.streetRoad, postcode: settings.postcode,
    townCounty: settings.townCounty, paymentMethod: settings.paymentMethod === 'Revolut' ? 'Revolut' : 'Card',
  });
  const [addrSuggestions, setAddrSuggestions] = useState([]);
  const [searchingAddr, setSearchingAddr] = useState(false);
  const addrTimerRef = useRef(null);

  const onStreetType = (val) => {
    setForm((f) => ({ ...f, streetRoad: val }));
    if (addrTimerRef.current) clearTimeout(addrTimerRef.current);
    if (val.trim().length < 3) {
      setAddrSuggestions([]);
      return;
    }
    setSearchingAddr(true);
    addrTimerRef.current = setTimeout(async () => {
      const list = await searchAddressSuggestions(val, form.country);
      setAddrSuggestions(list);
      setSearchingAddr(false);
    }, 350);
  };

  const pickAddressSuggestion = (s) => {
    setForm((f) => ({
      ...f,
      streetRoad: s.street || f.streetRoad,
      postcode: s.postcode || f.postcode,
      townCounty: s.town || f.townCounty,
    }));
    setAddrSuggestions([]);
  };

  const headerFileRef = useRef(null);
  const curr = (form.country || settings.country) === 'UK' ? '£' : '€';

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data?.session) setSession(data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener?.subscription?.unsubscribe();
  }, []);

  const loadOrdersAndDrivers = async () => {
    const phone = (settings.customerPhone || form.customerPhone || '').trim();
    if (!phone) return;
    try {
      const { data: ordData } = await supabase.from('orders').select('*').eq('customer_phone', phone).order('created_at', { ascending: false }).limit(25);
      if (ordData) {
        setOrders(ordData);
        const driverIds = [...new Set(ordData.map((o) => o.assigned_driver_id).filter(Boolean))];
        if (driverIds.length > 0) {
          const { data: drvData } = await supabase.from('drivers').select('*').in('id', driverIds);
          if (drvData) {
            const map = {};
            drvData.forEach((d) => { map[d.id] = d; });
            setDriversMap(map);
          }
        }
      }
    } catch {}
  };

  useEffect(() => {
    loadOrdersAndDrivers();
    const interval = setInterval(loadOrdersAndDrivers, 8000);
    const ch = supabase.channel('customer-live-tracking')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrdersAndDrivers())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, (payload) => {
        if (payload.new?.id) setDriversMap((prev) => ({ ...prev, [payload.new.id]: payload.new }));
      }).subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(ch); };
  }, [settings.customerPhone, form.customerPhone]);

  const handlePhotoUpload = (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 240;
        let w = img.width, h = img.height;
        if (w > h && w > maxSize) { h = Math.round((h * maxSize) / w); w = maxSize; }
        else if (h > maxSize) { w = Math.round((w * maxSize) / h); h = maxSize; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const next = { ...settings, customerPhoto: canvas.toDataURL('image/jpeg', 0.8) };
        setSettings(next);
        try { localStorage.setItem('swiftbuy_customer_settings', JSON.stringify(next)); } catch {}
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(files.item(0));
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthMsg('');
    if (!email.trim() || !password) return setAuthMsg('Enter your email and password.');
    setAuthLoading(true);
    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: authName.trim(), phone: authPhone.trim() } } });
      setAuthLoading(false);
      if (error) return setAuthMsg(error.message);
      const next = { ...settings, customerName: authName.trim() || settings.customerName, customerPhone: authPhone.trim() || settings.customerPhone };
      localStorage.setItem('swiftbuy_customer_settings', JSON.stringify(next));
      setSettings(next);
      setForm((f) => ({ ...f, customerName: next.customerName, customerPhone: next.customerPhone }));
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setAuthLoading(false);
      if (error) return setAuthMsg(error.message);
    }
  };
  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); setGuestMode(false); };

  const saveSettings = (e) => {
    e.preventDefault();
    const cleanPay = settings.paymentMethod === 'Revolut' ? 'Revolut' : 'Card';
    const next = { ...settings, paymentMethod: cleanPay };
    localStorage.setItem('swiftbuy_customer_settings', JSON.stringify(next));
    setSettings(next);
    setForm((f) => ({ ...f, country: next.country, customerName: next.customerName, customerPhone: next.customerPhone, doorNumber: next.doorNumber, streetRoad: next.streetRoad, postcode: next.postcode, townCounty: next.townCounty, paymentMethod: cleanPay }));
    if (next.soundEnabled) playConfirmChime();
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2500);
  };

  const addGroceryItem = (label, qty = 1) => {
    const clean = label.trim();
    if (!clean) return;
    setCartItems((prev) => {
      const idx = prev.findIndex((i) => i.name.toLowerCase() === clean.toLowerCase());
      if (idx > -1) { const copy = [...prev]; copy[idx] = { ...copy[idx], qty: copy[idx].qty + Number(qty || 1) }; return copy; }
      return [...prev, { name: clean, qty: Number(qty || 1) }];
    });
  };

  const removeGroceryItem = (index) => setCartItems((prev) => prev.filter((_, i) => i !== index));
  const activeStoreName = selectedShop === 'Custom' ? customShopName.trim() : selectedShop;
  const combinedItemsText = [...cartItems.map((i) => `${i.qty}x ${i.name}`), form.itemsList.trim()].filter(Boolean).join(', ');

  const placeOrder = async (e) => {
    e.preventDefault();
    if (!form.customerName || !form.customerPhone || !activeStoreName || !combinedItemsText || !form.streetRoad || !form.townCounty) {
      return alert('Please choose a Shop, add Grocery Items, and fill in Name, Phone, Street, and Town/County.');
    }
    setSubmitting(true);
    const dropCoords = await geocodePlace(form.streetRoad, form.postcode, form.townCounty, form.country);
    if (!dropCoords) { setSubmitting(false); return alert('Address or Postcode/Eircode not found.'); }
    const storeCoords = (await geocodePlace(activeStoreName, '', form.townCounty, form.country)) || dropCoords;
    const dist = calcKm(storeCoords.lat, storeCoords.lng, dropCoords.lat, dropCoords.lng);
    if (dist > 7) { setSubmitting(false); return alert(`Store to delivery address is ${dist} km (max 7 km).`); }
    const id = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const tip = parseFloat(form.tipAmount || '0');
    const totalFee = parseFloat(form.deliveryFee || '5') + tip;
    const payload = {
      id, customer_name: form.customerName.trim(), customer_phone: form.customerPhone.trim(),
      store_name: activeStoreName, items_list: `${combinedItemsText} [Pay: ${form.paymentMethod}]`,
      estimated_goods_cost: parseFloat(form.estimatedGoodsCost || '0'),
      delivery_fee: totalFee, tip_amount: tip, vehicle: 'Any Vehicle',
      door_number: form.doorNumber.trim(), street_road: form.streetRoad.trim(),
      postcode: form.postcode.trim(), town_county: form.townCounty.trim(),
      region: form.country, distance_km: dist, status: 'pending',
    };
    const { error } = await supabase.from('orders').insert(payload);
    setSubmitting(false);
    if (error) return alert('Could not place order: ' + error.message);
    const nextSettings = { ...settings, customerName: form.customerName.trim(), customerPhone: form.customerPhone.trim(), doorNumber: form.doorNumber.trim(), streetRoad: form.streetRoad.trim(), postcode: form.postcode.trim(), townCounty: form.townCounty.trim() };
    localStorage.setItem('swiftbuy_customer_settings', JSON.stringify(nextSettings));
    setSettings(nextSettings);
    if (settings.soundEnabled) playConfirmChime();
    setCartItems([]);
    setForm((f) => ({ ...f, itemsList: '', estimatedGoodsCost: '' }));
    setTab('orders');
    loadOrdersAndDrivers();
  };

  const submitDriverRating = async (order) => {
    const draft = ratingDrafts[order.id] || { stars: 5, comment: '' };
    const stars = draft.stars || 5;
    const updated = { ...ratings, [order.id]: { stars, comment: (draft.comment || '').trim() } };
    setRatings(updated);
    try { localStorage.setItem('swiftbuy_order_ratings', JSON.stringify(updated)); } catch {}
    try { await supabase.from('orders').update({ driver_rating: stars, rating_comment: (draft.comment || '').trim() }).eq('id', order.id); } catch {}
    if (settings.soundEnabled) playConfirmChime();
  };

  const card = { background: '#131c31', border: '1px solid #23304d', borderRadius: 16, padding: 16, marginBottom: 14 };
  const input = { width: '100%', boxSizing: 'border-box', background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, color: '#f8fafc', padding: '11px 12px', fontSize: 14, marginBottom: 10, outline: 'none' };
  const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer' });

  if (!session && !guestMode) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 36 }}>🛒</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#38bdf8' }}>SwiftBuy</div>
          <div style={{ fontSize: 13, color: '#10b981', fontWeight: 700 }}>Local Grocery Delivery</div>
        </div>
        <div style={card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button type="button" onClick={() => setAuthMode('login')} style={{ ...btn(authMode === 'login' ? '#2563eb' : '#1e293b'), flex: 1 }}>Log In</button>
            <button type="button" onClick={() => setAuthMode('signup')} style={{ ...btn(authMode === 'signup' ? '#10b981' : '#1e293b'), flex: 1 }}>Sign Up</button>
          </div>
          {authMsg && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: 9, fontSize: 12, marginBottom: 10 }}>{authMsg}</div>}
          <form onSubmit={handleAuth}>
            {authMode === 'signup' && (<><input style={input} placeholder="Full Name" value={authName} onChange={(e) => setAuthName(e.target.value)} required /><input style={input} placeholder="Mobile Phone" value={authPhone} onChange={(e) => setAuthPhone(e.target.value)} required /></>)}
            <input style={input} type="email" placeholder="Email Address" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input style={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button disabled={authLoading} type="submit" style={{ ...btn(authMode === 'signup' ? '#10b981' : '#2563eb'), width: '100%', padding: 13, fontSize: 15, marginBottom: 10 }}>{authLoading ? 'Please wait...' : authMode === 'signup' ? 'Sign Up' : 'Log In'}</button>
          </form>
          <button type="button" onClick={() => setGuestMode(true)} style={{ ...btn('#1e293b'), width: '100%', padding: 10, color: '#94a3b8' }}>Continue as Guest</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', color: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: '14px 14px 40px' }}>
      <input ref={headerFileRef} type="file" accept="image/*" onChange={handlePhotoUpload} style={{ display: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div onClick={() => headerFileRef.current?.click()} style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', border: '2px solid #10b981', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            {settings.customerPhoto ? <img src={settings.customerPhoto} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 18 }}>📷</span>}
          </div>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#38bdf8' }}>SwiftBuy</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', letterSpacing: 0.4 }}>Groceries</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setTab('order')} style={btn(tab === 'order' ? '#10b981' : '#1e293b')}>+ Order</button>
          <button onClick={() => setTab('orders')} style={btn(tab === 'orders' ? '#2563eb' : '#1e293b')}>Orders</button>
          <button onClick={() => setTab('settings')} style={btn(tab === 'settings' ? '#8b5cf6' : '#1e293b')}>⚙️</button>
        </div>
      </div>

      {tab === 'order' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>New Grocery Order</h2>
            <select value={form.country} onChange={(e) => { const c = e.target.value; setForm({ ...form, country: c, townCounty: c === 'UK' ? 'Newry, Co. Down' : 'Dundalk, Co. Louth' }); }} style={{ background: '#0b1120', color: '#f8fafc', border: '1px solid #2b3856', borderRadius: 8, padding: '6px 8px', fontSize: 12, fontWeight: 700 }}>
              <option value="IE">🇮🇪 Ireland (€)</option>
              <option value="UK">🇬🇧 UK (£)</option>
            </select>
          </div>
          <form onSubmit={placeOrder}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>1. Choose Supermarket or Any Shop</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
              {SHOPS.map((s) => (
                <button key={s.id} type="button" onClick={() => { setSelectedShop(s.id); if (s.id !== 'Custom') setForm({ ...form, storeName: s.id }); }} style={{ background: selectedShop === s.id ? '#1d4ed8' : '#0b1120', border: selectedShop === s.id ? '1px solid #60a5fa' : '1px solid #2b3856', borderRadius: 10, color: '#f8fafc', padding: '8px 6px', textAlign: 'center', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.tag}</div>
                </button>
              ))}
            </div>
            {selectedShop === 'Custom' && (
              <input style={input} placeholder="Type any shop name (e.g. Centra, SuperValu, Local Butcher...)" value={customShopName} onChange={(e) => { setCustomShopName(e.target.value); setForm({ ...form, storeName: e.target.value }); }} required />
            )}

            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6, marginTop: 4 }}>2. Add Grocery Items</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {QUICK_GROCERIES.map((item) => (
                <button key={item} type="button" onClick={() => addGroceryItem(item, 1)} style={{ background: '#0b1120', border: '1px solid #2b3856', borderRadius: 20, color: '#e2e8f0', fontSize: 11, padding: '5px 9px', cursor: 'pointer' }}>+ {item}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input style={{ ...input, marginBottom: 0, width: '64px', textAlign: 'center' }} type="number" min="1" value={newItemQty} onChange={(e) => setNewItemQty(e.target.value)} placeholder="Qty" />
              <input style={{ ...input, marginBottom: 0, flex: 1 }} placeholder="Custom item (e.g. Organic Honey)" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
              <button type="button" onClick={() => { if (newItemName.trim()) { addGroceryItem(newItemName, newItemQty); setNewItemName(''); setNewItemQty('1'); } }} style={btn('#10b981')}>Add</button>
            </div>
            {cartItems.length > 0 && (
              <div style={{ background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, padding: 8, marginBottom: 10 }}>
                {cartItems.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 2px', borderBottom: idx < cartItems.length - 1 ? '1px solid #1e293b' : 'none', fontSize: 13 }}>
                    <span><b style={{ color: '#38bdf8' }}>{it.qty}x</b> {it.name}</span>
                    <button type="button" onClick={() => removeGroceryItem(idx)} style={{ background: 'transparent', border: 'none', color: '#f87171', fontWeight: 700, cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea style={{ ...input, minHeight: 54, resize: 'vertical' }} placeholder="Extra grocery notes or list..." value={form.itemsList} onChange={(e) => setForm({ ...form, itemsList: e.target.value })} />
            <input style={input} type="number" step="0.01" placeholder={`Estimated Goods Cost (${curr}) — optional`} value={form.estimatedGoodsCost} onChange={(e) => setForm({ ...form, estimatedGoodsCost: e.target.value })} />

            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>3. Delivery Address & Contact</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder="Your Name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
              <input style={input} placeholder="Phone Number" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} required />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...input, width: '36%' }} placeholder="Door/Apt" value={form.doorNumber} onChange={(e) => setForm({ ...form, doorNumber: e.target.value })} />
              <div style={{ position: 'relative', flex: 1 }}>
                <input style={input} placeholder="Start typing street or Eircode..." value={form.streetRoad} onChange={(e) => onStreetType(e.target.value)} required />
                {(searchingAddr || addrSuggestions.length > 0) && (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: 44, zIndex: 50, background: '#0f172a', border: '1px solid #38bdf8', borderRadius: 10, boxShadow: '0 10px 25px rgba(0,0,0,0.65)', overflow: 'hidden' }}>
                    {searchingAddr && <div style={{ padding: '8px 10px', fontSize: 12, color: '#94a3b8' }}>🔍 Searching map addresses...</div>}
                    {addrSuggestions.map((s, idx) => (
                      <div key={idx} onClick={() => pickAddressSuggestion(s)} style={{ padding: '9px 10px', fontSize: 12, borderBottom: idx < addrSuggestions.length - 1 ? '1px solid #1e293b' : 'none', cursor: 'pointer', color: '#f8fafc' }}>
                        📍 {s.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder={form.country === 'UK' ? 'Postcode' : 'Eircode (e.g. A91 P592)'} value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
              <input style={input} placeholder="Town & County" value={form.townCounty} onChange={(e) => setForm({ ...form, townCounty: e.target.value })} required />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>4. Driver Tip ({curr})</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {TIP_PRESETS.map((t) => (
                <button key={t} type="button" onClick={() => setForm({ ...form, tipAmount: t })} style={{ ...btn(String(form.tipAmount) === t ? '#10b981' : '#0b1120'), flex: 1, border: String(form.tipAmount) === t ? '1px solid #34d399' : '1px solid #2b3856' }}>
                  {t === '0' ? 'No Tip' : `${curr}${t}`}
                </button>
              ))}
              <input style={{ ...input, marginBottom: 0, width: 76, textAlign: 'center' }} type="number" step="0.50" min="0" placeholder="Custom" value={form.tipAmount} onChange={(e) => setForm({ ...form, tipAmount: e.target.value })} />
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>5. Payment Method</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {PAY_OPTIONS.map((p) => (
                <button key={p.id} type="button" onClick={() => setForm({ ...form, paymentMethod: p.id })} style={{ ...btn(form.paymentMethod === p.id ? '#2563eb' : '#0b1120'), flex: 1, padding: '10px 6px', border: form.paymentMethod === p.id ? '1px solid #38bdf8' : '1px solid #2b3856' }}>{p.label}</button>
              ))}
            </div>

            <button disabled={submitting} type="submit" style={{ ...btn('#10b981'), width: '100%', padding: 13, fontSize: 15 }}>
              {submitting ? 'Calculating GPS Distance...' : `Submit Order • ${form.paymentMethod} (${curr}${(Number(form.deliveryFee || 0) + Number(form.tipAmount || 0)).toFixed(2)})`}
            </button>
          </form>
        </div>
      )}

      {tab === 'orders' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>My Orders & Live Tracking</h2>
            <button type="button" onClick={loadOrdersAndDrivers} style={btn('#1e293b')}>↻ Refresh</button>
          </div>
          {orders.length === 0 ? (
            <div style={card}><div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: 16 }}>No orders found for {settings.customerPhone || 'your phone number'} yet.</div></div>
          ) : (
            orders.map((o) => {
              const assignedDriver = o.assigned_driver_id ? driversMap[o.assigned_driver_id] : null;
              const isDelivered = String(o.status || '').toLowerCase() === 'delivered';
              const savedRating = ratings[o.id];
              const draft = ratingDrafts[o.id] || { stars: 5, comment: '' };
              return (
                <div key={o.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <b style={{ fontSize: 15 }}>{o.store_name}</b>
                    <span style={{ color: isDelivered ? '#10b981' : '#38bdf8', fontWeight: 700, fontSize: 13, textTransform: 'uppercase' }}>{o.status}</span>
                  </div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>{o.items_list}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>{o.id} • {o.door_number} {o.street_road}, {o.postcode}</div>
                  {!isDelivered && assignedDriver && <LiveDriverMap driver={assignedDriver} />}
                  {!isDelivered && !assignedDriver && (
                    <div style={{ marginTop: 10, background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, padding: 10, fontSize: 12, color: '#94a3b8' }}>
                      ⏳ Waiting for a nearby driver (🚴 Bike, 🏍️ Motorcycle, or 🚗 Car) to accept your order...
                    </div>
                  )}
                  {isDelivered && (
                    <div style={{ marginTop: 12, background: '#0b1120', border: '1px solid #2b3856', borderRadius: 12, padding: 12 }}>
                      {savedRating ? (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>Your Driver Rating: {'★'.repeat(savedRating.stars)}{'☆'.repeat(5 - savedRating.stars)} ({savedRating.stars}/5)</div>
                          {savedRating.comment && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>"{savedRating.comment}"</div>}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Rate Your Driver Delivery</div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <button key={star} type="button" onClick={() => setRatingDrafts((prev) => ({ ...prev, [o.id]: { ...draft, stars: star } }))} style={{ background: 'transparent', border: 'none', fontSize: 24, color: star <= draft.stars ? '#fbbf24' : '#475569', cursor: 'pointer', padding: 0 }}>★</button>
                            ))}
                          </div>
                          <input style={{ ...input, marginBottom: 8 }} placeholder="Leave a quick note for your driver (optional)" value={draft.comment} onChange={(e) => setRatingDrafts((prev) => ({ ...prev, [o.id]: { ...draft, comment: e.target.value } }))} />
                          <button type="button" onClick={() => submitDriverRating(o)} style={btn('#10b981')}>Submit Rating</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
      {tab === 'settings' && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Profile & Settings</h2>
            <span style={{ fontSize: 11, color: '#38bdf8' }}>{session?.user?.email || 'Guest'}</span>
          </div>
          {savedBanner && <div style={{ background: '#064e3b', border: '1px solid #10b981', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 13 }}>✅ Profile & Settings saved!</div>}
          <form onSubmit={saveSettings}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, background: '#0b1120', padding: 10, borderRadius: 10, border: '1px solid #2b3856' }}>
              {settings.customerPhoto ? <img src={settings.customerPhoto} alt="Profile" style={{ width: 58, height: 58, borderRadius: '50%', objectFit: 'cover', border: '2px solid #10b981' }} /> : <div style={{ width: 58, height: 58, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>👤</div>}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Customer Profile Photo</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Choose any picture from gallery or camera</div>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ fontSize: 12, color: '#9ca3af' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder="Default Name" value={settings.customerName} onChange={(e) => setSettings({ ...settings, customerName: e.target.value })} />
              <input style={input} placeholder="Default Phone" value={settings.customerPhone} onChange={(e) => setSettings({ ...settings, customerPhone: e.target.value })} />
            </div>
            <select style={input} value={settings.paymentMethod} onChange={(e) => setSettings({ ...settings, paymentMethod: e.target.value })}>
              <option value="Card">💳 Card</option>
              <option value="Revolut">📱 Revolut</option>
            </select>
            <select style={input} value={settings.country} onChange={(e) => setSettings({ ...settings, country: e.target.value, townCounty: e.target.value === 'UK' ? 'Newry, Co. Down' : 'Dundalk, Co. Louth' })}>
              <option value="IE">🇮🇪 Ireland (€)</option>
              <option value="UK">🇬🇧 UK (£)</option>
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...input, width: '36%' }} placeholder="Door/Apt" value={settings.doorNumber} onChange={(e) => setSettings({ ...settings, doorNumber: e.target.value })} />
              <input style={input} placeholder="Default Street / Road" value={settings.streetRoad} onChange={(e) => setSettings({ ...settings, streetRoad: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={input} placeholder={settings.country === 'UK' ? 'UK Postcode' : 'Eircode (e.g. A91 P592)'} value={settings.postcode} onChange={(e) => setSettings({ ...settings, postcode: e.target.value })} />
              <input style={input} placeholder="Default Town & County" value={settings.townCounty} onChange={(e) => setSettings({ ...settings, townCounty: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0b1120', border: '1px solid #2b3856', borderRadius: 10, padding: '11px 12px', marginBottom: 14, fontSize: 13 }}>
              <span>🔔 Sound Alerts</span>
              <input type="checkbox" checked={settings.soundEnabled} onChange={(e) => setSettings({ ...settings, soundEnabled: e.target.checked })} />
            </label>
            <button type="submit" style={{ ...btn('#10b981'), width: '100%', padding: 12, fontSize: 14, marginBottom: 10 }}>Save Settings</button>
            <button type="button" onClick={handleLogout} style={{ ...btn('#dc2626'), width: '100%', padding: 12, fontSize: 14 }}>Log Out</button>
          </form>
        </div>
      )}
    </div>
  );
}
