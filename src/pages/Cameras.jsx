import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera, Video, RotateCw, Trash2, Plus, Building,
  RefreshCw, Copy, Check, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Square,
  Info, ShieldCheck, X, Loader2, WifiOff, Shield,
  Tv2, Activity
} from 'lucide-react';
import { toast } from 'sonner';
import { getSessionToken } from '../lib/session.js';

/* ─── Inline style tokens (immune to Tailwind tree-shaking) ─── */
const COLOR = {
  bg: '#0f172a',
  bgDeep: '#020617',
  bgCard: 'rgba(15,23,42,0.9)',
  border: '#1e293b',
  borderPurp: 'rgba(147,51,234,0.45)',
  borderFaint: 'rgba(147,51,234,0.2)',
  textMuted: '#64748b',
  textSub: '#94a3b8',
  textBase: '#cbd5e1',
  textBright: '#f8fafc',
  purple: '#9333ea',
  purpleHov: '#a855f7',
  purpleDark: 'rgba(88,28,135,0.5)',
};

/* Shared transition */
const TR = 'all 0.15s ease-out';

/* Button base */
const B = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '7px',
  fontFamily: 'inherit',
  fontWeight: '600',
  cursor: 'pointer',
  userSelect: 'none',
  border: 'none',
  outline: 'none',
  transition: TR,
  whiteSpace: 'nowrap',
};

/* Variants */
const Btn = {
  primary: {
    ...B,
    backgroundColor: '#9333ea',
    color: '#fff',
    borderRadius: '12px',
    padding: '9px 18px',
    fontSize: '13px',
    boxShadow: '0 8px 24px rgba(147,51,234,0.35)',
  },
  secondary: {
    ...B,
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '9px 16px',
    fontSize: '13px',
  },
  ghost: {
    ...B,
    backgroundColor: 'transparent',
    color: '#94a3b8',
    borderRadius: '10px',
    padding: '8px',
    fontSize: '13px',
    width: '36px',
    height: '36px',
  },
  danger: {
    ...B,
    backgroundColor: 'rgba(28,6,6,0.7)',
    color: '#fca5a5',
    border: '1px solid rgba(220,38,38,0.35)',
    borderRadius: '10px',
    padding: '5px 8px',
    fontSize: '12px',
    width: '28px',
    height: '28px',
  },
  icon: {
    ...B,
    backgroundColor: '#0f172a',
    color: '#94a3b8',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '0',
    width: '38px',
    height: '38px',
    fontSize: '13px',
  },
  ptz: {
    ...B,
    backgroundColor: 'rgba(30,41,59,0.8)',
    color: '#c084fc',
    border: '1px solid #334155',
    borderRadius: '12px',
    width: '100%',
    height: '48px',
    padding: '0',
    fontSize: '13px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
  ptzStop: {
    ...B,
    backgroundColor: '#dc2626',
    color: '#fff',
    borderRadius: '12px',
    width: '100%',
    height: '48px',
    padding: '0',
    fontSize: '13px',
    boxShadow: '0 2px 8px rgba(220,38,38,0.35)',
  },
  ptzSm: {
    ...B,
    backgroundColor: 'rgba(30,41,59,0.8)',
    color: '#c084fc',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '7px 12px',
    fontSize: '12px',
    width: '100%',
  },
  sm: {
    ...B,
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    border: '1px solid #334155',
    borderRadius: '10px',
    padding: '5px 11px',
    fontSize: '11px',
    flex: '1',
  },
};

/* Input shared style */
const INPUT = {
  width: '100%',
  backgroundColor: '#020617',
  border: '1px solid rgba(147,51,234,0.5)',
  color: '#f8fafc',
  borderRadius: '12px',
  padding: '10px 14px',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease',
  fontFamily: 'inherit',
};

const LABEL = {
  fontSize: '11px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
  display: 'block',
  marginBottom: '7px',
};

/* ─── Sub-components defined OUTSIDE Cameras to prevent re-mount on each render ─── */

function StatusBadge({ status }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 10px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', border: '1px solid', ...(status === 'active' ? { background: 'rgba(6,78,59,0.5)', color: '#34d399', borderColor: 'rgba(52,211,153,0.3)' } : { background: 'rgba(120,53,15,0.5)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)' }) }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: status === 'active' ? '#34d399' : '#fbbf24', animation: status === 'active' ? 'pulse 2s infinite' : 'none' }} />
      {status === 'active' ? 'Live' : 'Offline'}
    </span>
  );
}

function BrandBadge({ brand }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '6px', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', border: '1px solid', ...(brand === 'hikvision' ? { background: 'rgba(8,51,68,0.6)', color: '#67e8f9', borderColor: 'rgba(103,232,249,0.25)' } : { background: 'rgba(59,7,100,0.6)', color: '#d8b4fe', borderColor: 'rgba(216,180,254,0.25)' }) }}>
      <Shield size={9} />{brand === 'hikvision' ? 'Hikvision ISAPI' : 'Dahua CGI'}
    </span>
  );
}

/** ptzLoading and selectedCamera passed as props — no closure capture */
function PtzBtn({ onClick, title, stop, disabled, children }) {
  return (
    <button
      style={{ ...(stop ? Btn.ptzStop : Btn.ptz), opacity: disabled ? 0.4 : 1 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={e => { if (!stop) { e.currentTarget.style.borderColor = '#a855f7'; e.currentTarget.style.background = 'rgba(88,28,135,0.45)'; } else { e.currentTarget.style.background = '#b91c1c'; } }}
      onMouseLeave={e => { if (!stop) { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.background = 'rgba(30,41,59,0.8)'; } else { e.currentTarget.style.background = '#dc2626'; } }}
    >
      {children}
    </button>
  );
}

function Backdrop({ onClose, children }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99999, backgroundColor: 'rgba(2,4,10,0.88)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', boxSizing: 'border-box', overflowY: 'auto' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

export default function Cameras({ role = 'landlord' }) {
  const [cameras, setCameras] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSysModal, setShowSysModal] = useState(false);
  const [sysInfo, setSysInfo] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [ptzLoading, setPtzLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [rebootingId, setRebootingId] = useState(null);
  const [form, setForm] = useState({
    name: '', brand: 'dahua', ip_address: '', port: '80',
    rtsp_port: '554', username: 'admin', password: '', channel_no: '1', property_id: ''
  });
  const patch = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const hdrs = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getSessionToken() || localStorage.getItem('auth_token') || ''}`
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [cr, pr] = await Promise.all([fetch('/api/cameras', { headers: hdrs() }), fetch('/api/properties', { headers: hdrs() })]);
      if (cr.ok) { const d = await cr.json(); setCameras(d); if (d.length > 0 && !selectedCamera) setSelectedCamera(d[0]); }
      if (pr.ok) setProperties(await pr.json());
    } catch (e) { toast.error('Failed to load cameras: ' + e.message); }
    finally { setLoading(false); }
  };

  const saveCamera = async (e) => {
    e.preventDefault();
    if (!form.name || !form.ip_address) { toast.error('Name and IP required.'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/cameras', { method: 'POST', headers: hdrs(), body: JSON.stringify(form) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || d.message || 'Failed.'); }
      const c = await r.json();
      toast.success(`"${c.name}" (${c.brand.toUpperCase()}) registered!`);
      setShowAddModal(false);
      setForm({ name: '', brand: 'dahua', ip_address: '', port: '80', rtsp_port: '554', username: 'admin', password: '', channel_no: '1', property_id: '' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteCamera = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const r = await fetch(`/api/cameras/${id}`, { method: 'DELETE', headers: hdrs() });
      if (!r.ok) throw new Error('Delete failed');
      toast.success(`"${name}" removed.`);
      if (selectedCamera?.id === id) setSelectedCamera(null);
      load();
    } catch (e) { toast.error(e.message); }
    finally { setDeletingId(null); }
  };

  const ptz = async (code, action = 'start', arg1 = 4, arg2 = 4) => {
    if (!selectedCamera) return;
    setPtzLoading(true);
    try {
      const r = await fetch(`/api/cameras/${selectedCamera.id}/ptz`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action, code, arg1, arg2 }) });
      if (!r.ok) { const d = await r.json(); throw new Error(d.message || 'PTZ failed'); }
      toast.success(`PTZ ${code} OK.`);
    } catch (e) { toast.error(e.message); }
    finally { setPtzLoading(false); }
  };

  const reboot = async (id, name, brand) => {
    if (!window.confirm(`Reboot "${name}" via ${brand === 'hikvision' ? 'ISAPI' : 'CGI'}?`)) return;
    setRebootingId(id);
    try {
      const r = await fetch(`/api/cameras/${id}/reboot`, { method: 'POST', headers: hdrs() });
      if (!r.ok) throw new Error('Reboot failed.');
      const d = await r.json();
      toast.success(d.message || 'Reboot sent!');
    } catch (e) { toast.error(e.message); }
    finally { setRebootingId(null); }
  };

  const fetchSysInfo = async (cam) => {
    try {
      const r = await fetch(`/api/cameras/${cam.id}`, { headers: hdrs() });
      if (!r.ok) throw new Error('Failed to fetch info.');
      setSysInfo(await r.json()); setShowSysModal(true);
    } catch (e) { toast.error(e.message); }
  };

  const copyRtsp = (url) => { navigator.clipboard.writeText(url); setCopiedUrl(true); toast.success('Copied!'); setTimeout(() => setCopiedUrl(false), 2000); };

  /* StatusBadge, BrandBadge, PtzBtn, Backdrop are defined above the component */


  return (
    <>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100%{ opacity:1; } 50%{ opacity:.4; } }
        @keyframes slideIn { from { opacity:0; transform:translateY(14px) scale(0.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes ping    { 0%{ transform:scale(1); opacity:1; } 75%,100%{ transform:scale(1.8); opacity:0; } }
        .cam-card { transition: all 0.18s ease-out; }
        .cam-card:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(88,28,135,0.18); }
        .cam-card.selected { border-color: #9333ea !important; background: rgba(88,28,135,0.15) !important; box-shadow: 0 0 0 1px rgba(147,51,234,0.2), 0 12px 32px rgba(88,28,135,0.2); }
        .btn-primary:hover  { background:#a855f7 !important; transform:translateY(-1px); box-shadow:0 12px 28px rgba(147,51,234,0.45) !important; }
        .btn-primary:active { transform:scale(0.97) translateY(0) !important; }
        .btn-secondary:hover { background:#263045 !important; border-color:#475569 !important; color:#f1f5f9 !important; }
        .btn-secondary:active { transform:scale(0.97); }
        .btn-ghost:hover  { background:rgba(30,41,59,0.8) !important; color:#f1f5f9 !important; }
        .btn-danger:hover { background:rgba(60,10,10,0.9) !important; border-color:rgba(220,38,38,0.6) !important; color:#fca5a5 !important; }
        .btn-icon:hover   { background:#1e293b !important; border-color:#334155 !important; color:#f1f5f9 !important; }
        .btn-sm:hover     { background:#263045 !important; border-color:#475569 !important; color:#f1f5f9 !important; }
        .btn-sm:active, .btn-danger:active, .btn-icon:active { transform:scale(0.96); }
        .input-field:focus { border-color:#9333ea !important; box-shadow:0 0 0 3px rgba(147,51,234,0.15); }
        .ptz-sm:hover  { border-color:#a855f7 !important; background:rgba(88,28,135,0.35) !important; }
      `}</style>

      <div style={{ padding: '24px 32px', maxWidth: '1280px', margin: '0 auto' }}>

        {/* ─── Header ─── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', paddingBottom: '20px', borderBottom: `1px solid ${COLOR.border}`, marginBottom: '24px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '20px', fontWeight: '700', color: COLOR.textBright, margin: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg,rgba(88,28,135,0.7),rgba(49,17,93,0.5))', border: '1px solid rgba(147,51,234,0.35)', color: '#c084fc' }}>
                <Camera size={20} />
              </span>
              CCTV &amp; Security Cameras
            </h2>
            <p style={{ margin: '6px 0 0 54px', fontSize: '13px', color: COLOR.textMuted }}>
              Monitor live CCTV feeds, control PTZ movements, and manage Dahua IPC CGI &amp; Hikvision ISAPI integrations.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              className="btn-icon"
              style={Btn.icon}
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              className="btn-primary"
              style={Btn.primary}
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={15} /> Add Camera
            </button>
          </div>
        </div>

        {/* ─── Loading ─── */}
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', background: 'rgba(15,23,42,0.6)', border: `1px solid ${COLOR.border}`, borderRadius: '16px' }}>
            <Loader2 size={34} style={{ color: '#a855f7', animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 12px' }} />
            <p style={{ color: COLOR.textMuted, fontSize: '13px', margin: 0 }}>Connecting to camera network…</p>
          </div>

          /* ─── Empty ─── */
        ) : cameras.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 24px', gap: '20px', background: 'rgba(15,23,42,0.5)', border: `1px solid ${COLOR.border}`, borderRadius: '20px' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ width: '88px', height: '88px', borderRadius: '50%', background: 'rgba(88,28,135,0.2)', border: '1px solid rgba(147,51,234,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Camera size={38} style={{ color: '#a855f7' }} />
              </div>
              <span style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '28px', height: '28px', borderRadius: '50%', background: '#0f172a', border: `2px solid ${COLOR.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <WifiOff size={13} style={{ color: COLOR.textMuted }} />
              </span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '700', color: COLOR.textBright, margin: '0 0 6px' }}>No Security Cameras Connected</h3>
              <p style={{ fontSize: '13px', color: COLOR.textMuted, margin: 0, maxWidth: '320px' }}>
                Register your Dahua IPC or Hikvision ISAPI cameras to start monitoring live security feeds.
              </p>
            </div>
            <button className="btn-primary" style={Btn.primary} onClick={() => setShowAddModal(true)}>
              <Plus size={15} /> Register First Camera
            </button>
          </div>

          /* ─── Main Grid ─── */
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>

            {/* Left column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

              {/* Viewer */}
              {selectedCamera && (
                <div style={{ background: COLOR.bgCard, border: `1px solid rgba(147,51,234,0.18)`, borderRadius: '18px', padding: '20px', boxShadow: '0 20px 48px rgba(0,0,0,0.35)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', paddingBottom: '14px', borderBottom: `1px solid ${COLOR.border}`, marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '15px', fontWeight: '700', color: COLOR.textBright, margin: 0 }}>
                          <Tv2 size={17} style={{ color: '#a855f7' }} /> {selectedCamera.name}
                        </h3>
                        <BrandBadge brand={selectedCamera.brand} />
                      </div>
                      <p style={{ fontSize: '12px', color: COLOR.textMuted, margin: 0 }}>
                        {selectedCamera.property_name} &middot;{' '}
                        <code style={{ color: '#c084fc', background: 'rgba(88,28,135,0.2)', padding: '1px 6px', borderRadius: '5px', border: `1px solid rgba(147,51,234,0.2)` }}>
                          {selectedCamera.ip_address}:{selectedCamera.port}
                        </code>
                        {' '}&middot; Ch {selectedCamera.channel_no}
                      </p>
                    </div>
                    <StatusBadge status={selectedCamera.status} />
                  </div>

                  {/* Viewport */}
                  <div style={{ position: 'relative', width: '100%', height: '360px', background: '#070a12', borderRadius: '12px', border: `1px solid ${COLOR.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', border: `1px solid ${COLOR.border}`, padding: '5px 12px', borderRadius: '8px', color: '#34d399', fontFamily: 'monospace', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '7px', zIndex: 1 }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399', animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite', display: 'inline-block' }} />
                      {selectedCamera.brand.toUpperCase()} LIVE · {selectedCamera.ip_address}
                    </div>
                    <Video size={60} style={{ color: 'rgba(100,116,139,0.3)', marginBottom: '12px' }} />
                    <p style={{ fontSize: '13px', fontWeight: '700', color: COLOR.textBase, margin: '0 0 4px' }}>{selectedCamera.name} Viewport</p>
                    <p style={{ fontSize: '11px', color: COLOR.textMuted, textAlign: 'center', maxWidth: '280px', margin: 0 }}>
                      HTML5 HLS / WebRTC · {selectedCamera.brand === 'hikvision' ? 'ISAPI' : 'CGI'} RTSP stream ready
                    </p>
                  </div>

                  {/* RTSP bar */}
                  <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(2,6,23,0.8)', border: `1px solid ${COLOR.border}`, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: '10px', color: COLOR.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '3px' }}>RTSP Stream</span>
                      <code style={{ fontSize: '11px', color: '#c084fc', wordBreak: 'break-all' }}>{selectedCamera.rtsp_stream_url}</code>
                    </div>
                    <button
                      className="btn-secondary"
                      style={{ ...Btn.secondary, padding: '6px 13px', fontSize: '12px' }}
                      onClick={() => copyRtsp(selectedCamera.rtsp_stream_url)}
                    >
                      {copiedUrl ? <><Check size={13} style={{ color: '#34d399' }} /> Copied!</> : <><Copy size={13} /> Copy URL</>}
                    </button>
                  </div>
                </div>
              )}

              {/* Camera cards */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: COLOR.textBright, margin: 0 }}>Configured Cameras</h4>
                  <span style={{ fontSize: '11px', padding: '1px 8px', borderRadius: '99px', background: '#1e293b', color: COLOR.textBase, border: `1px solid ${COLOR.border}`, fontFamily: 'monospace' }}>
                    {cameras.length}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
                  {cameras.map(cam => {
                    const sel = selectedCamera?.id === cam.id;
                    const isDel = deletingId === cam.id;
                    const isReb = rebootingId === cam.id;
                    return (
                      <div
                        key={cam.id}
                        className={`cam-card${sel ? ' selected' : ''}`}
                        onClick={() => setSelectedCamera(cam)}
                        style={{ position: 'relative', padding: '14px', borderRadius: '14px', cursor: 'pointer', border: `1px solid ${COLOR.border}`, background: 'rgba(15,23,42,0.8)' }}
                      >
                        {sel && (
                          <span style={{ position: 'absolute', top: '10px', right: '10px', width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7', animation: 'pulse 1.8s infinite' }} />
                        )}

                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', paddingRight: sel ? '16px' : '0' }}>
                          <div>
                            <p style={{ fontSize: '13px', fontWeight: '700', color: COLOR.textBright, margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{cam.name}</p>
                            <BrandBadge brand={cam.brand} />
                          </div>
                          <StatusBadge status={cam.status} />
                        </div>

                        <div style={{ borderTop: `1px solid rgba(30,41,59,0.7)`, paddingTop: '9px', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '11px', color: COLOR.textMuted }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Building size={10} style={{ color: '#475569' }} />
                            <span style={{ color: COLOR.textBase, fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.property_name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'monospace' }}>
                            <Activity size={10} style={{ color: '#475569' }} />
                            <code style={{ color: '#c084fc' }}>{cam.ip_address}:{cam.port}</code>
                            <span style={{ color: '#334155', fontSize: '10px' }}>· Ch {cam.channel_no}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                          <button
                            className="btn-sm"
                            style={Btn.sm}
                            onClick={() => fetchSysInfo(cam)}
                            title="Device Info"
                          >
                            <Info size={11} /> Info
                          </button>
                          <button
                            className="btn-sm"
                            style={{ ...Btn.sm, opacity: isReb ? 0.7 : 1 }}
                            onClick={() => reboot(cam.id, cam.name, cam.brand)}
                            disabled={isReb}
                            title="Reboot Camera"
                          >
                            {isReb ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCw size={11} />}
                            {isReb ? 'Rebooting…' : 'Reboot'}
                          </button>
                          <button
                            className="btn-danger"
                            style={{ ...Btn.danger, opacity: isDel ? 0.7 : 1 }}
                            onClick={() => deleteCamera(cam.id, cam.name)}
                            disabled={isDel}
                            title="Delete"
                          >
                            {isDel ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={11} />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: PTZ Sidebar */}
            <div style={{ position: 'sticky', top: '24px', background: COLOR.bgCard, border: `1px solid rgba(147,51,234,0.18)`, borderRadius: '18px', padding: '20px', boxShadow: '0 20px 48px rgba(0,0,0,0.3)' }}>
              <div style={{ paddingBottom: '14px', borderBottom: `1px solid ${COLOR.border}`, marginBottom: '18px' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '700', color: COLOR.textBright, margin: '0 0 4px' }}>
                  <ShieldCheck size={15} style={{ color: '#a855f7' }} /> PTZ Controller
                </h3>
                <p style={{ fontSize: '11px', color: COLOR.textMuted, margin: 0 }}>Pan · Tilt · Zoom directional control</p>
              </div>

              {/* D-Pad */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', maxWidth: '192px', margin: '0 auto 14px' }}>
                <div /><PtzBtn onClick={() => ptz('Up')} title="Tilt Up"><ChevronUp size={22} /></PtzBtn><div />
                <PtzBtn onClick={() => ptz('Left')} title="Pan Left"><ChevronLeft size={22} /></PtzBtn>
                <PtzBtn stop onClick={() => ptz('Stop', 'stop')} title="Stop PTZ"><Square size={14} /></PtzBtn>
                <PtzBtn onClick={() => ptz('Right')} title="Pan Right"><ChevronRight size={22} /></PtzBtn>
                <div /><PtzBtn onClick={() => ptz('Down')} title="Tilt Down"><ChevronDown size={22} /></PtzBtn><div />
              </div>

              {/* Zoom row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                <button className="ptz-sm" style={Btn.ptzSm} onClick={() => ptz('ZoomIn')} disabled={ptzLoading || !selectedCamera}><ZoomIn size={13} /> Zoom In</button>
                <button className="ptz-sm" style={Btn.ptzSm} onClick={() => ptz('ZoomOut')} disabled={ptzLoading || !selectedCamera}><ZoomOut size={13} /> Zoom Out</button>
              </div>

              {/* Preset */}
              <div>
                <label style={LABEL}>Jump to Preset</label>
                <select
                  style={{ ...INPUT, padding: '8px 12px', fontSize: '12px' }}
                  disabled={!selectedCamera || ptzLoading}
                  onChange={e => { if (e.target.value) ptz('GotoPreset', 'start', e.target.value, 0); }}
                  defaultValue=""
                >
                  <option value="" disabled style={{ backgroundColor: '#0f172a' }}>Select preset…</option>
                  {['Main Entrance Gate', 'Parking Lot', 'Stairwell & Corridor', 'Rear Perimeter'].map((n, i) => (
                    <option key={i + 1} value={i + 1} style={{ backgroundColor: '#0f172a' }}>Preset {i + 1} — {n}</option>
                  ))}
                </select>
              </div>

              {!selectedCamera && (
                <p style={{ textAlign: 'center', fontSize: '11px', color: COLOR.textMuted, marginTop: '14px' }}>
                  Select a camera to enable PTZ controls
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ══ Registration Modal ══ */}
      {showAddModal && createPortal(
        <Backdrop onClose={() => setShowAddModal(false)}>
          <div style={{ backgroundColor: '#0f172a', border: '1px solid rgba(168,85,247,0.35)', borderRadius: '20px', boxShadow: '0 32px 64px rgba(0,0,0,0.9)', width: '100%', maxWidth: '660px', maxHeight: '92vh', overflowY: 'auto', padding: '32px', color: '#f8fafc', animation: 'slideIn 0.2s ease-out' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '26px', paddingBottom: '20px', borderBottom: `1px solid ${COLOR.border}` }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                  <span style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg,rgba(88,28,135,0.8),rgba(49,17,93,0.6))', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Camera size={19} />
                  </span>
                  <h3 style={{ fontSize: '17px', fontWeight: '700', color: '#f8fafc', margin: 0 }}>Register Security IP Camera</h3>
                </div>
                <p style={{ fontSize: '12px', color: COLOR.textMuted, margin: '0 0 0 54px' }}>Configure Dahua IPC (CGI) or Hikvision (ISAPI) connection settings.</p>
              </div>
              <button className="btn-ghost" style={Btn.ghost} onClick={() => setShowAddModal(false)} title="Close">
                <X size={18} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={saveCamera} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {[
                [[{ k: 'brand', l: 'Camera Brand / Protocol', type: 'select' }, { k: 'name', l: 'Camera Label / Name', type: 'text', ph: 'e.g. Main Gate IPC 1' }]],
                [[{ k: 'property_id', l: 'Associated Property', type: 'select-prop' }, { k: 'ip_address', l: 'IP Address', type: 'text', ph: '192.168.1.108', mono: true }]],
                [[{ k: 'port', l: 'HTTP CGI/ISAPI Port', type: 'number' }, { k: 'rtsp_port', l: 'RTSP Port', type: 'number' }]],
                [[{ k: 'channel_no', l: 'Channel Number', type: 'number' }, { k: 'username', l: 'Camera Username', type: 'text', mono: true }]],
              ].map((row, ri) => (
                <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {row[0].map(f => (
                    <div key={f.k}>
                      <label style={LABEL}>{f.l}</label>
                      {f.type === 'select' ? (
                        <select className="input-field" style={INPUT} value={form.brand} onChange={e => patch('brand', e.target.value)}>
                          <option value="dahua" style={{ backgroundColor: '#0f172a' }}>Dahua IPC (Dahua CGI Protocol)</option>
                          <option value="hikvision" style={{ backgroundColor: '#0f172a' }}>Hikvision IP Camera (ISAPI Protocol)</option>
                        </select>
                      ) : f.type === 'select-prop' ? (
                        <select className="input-field" style={INPUT} value={form.property_id} onChange={e => patch('property_id', e.target.value)}>
                          <option value="" style={{ backgroundColor: '#0f172a' }}>All Properties / Global</option>
                          {properties.map(p => <option key={p.id} value={p.id} style={{ backgroundColor: '#0f172a' }}>{p.name}</option>)}
                        </select>
                      ) : (
                        <input
                          className="input-field"
                          type={f.type}
                          required={f.type !== 'password'}
                          style={{ ...INPUT, fontFamily: f.mono ? 'monospace' : 'inherit' }}
                          placeholder={f.ph || ''}
                          value={form[f.k]}
                          onChange={e => patch(f.k, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {/* Password full width */}
              <div>
                <label style={LABEL}>Camera Password</label>
                <input
                  className="input-field"
                  type="password"
                  style={INPUT}
                  placeholder="Encrypted & stored securely"
                  value={form.password}
                  onChange={e => patch('password', e.target.value)}
                />
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '16px', borderTop: `1px solid ${COLOR.border}`, marginTop: '4px' }}>
                <button type="button" className="btn-secondary" style={Btn.secondary} onClick={() => setShowAddModal(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ ...Btn.primary, minWidth: '130px' }} disabled={saving}>
                  {saving ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Camera size={15} /> Save Camera</>}
                </button>
              </div>
            </form>
          </div>
        </Backdrop>,
        document.body
      )}

      {/* ══ System Info Modal ══ */}
      {showSysModal && sysInfo && createPortal(
        <Backdrop onClose={() => setShowSysModal(false)}>
          <div style={{ backgroundColor: '#0f172a', border: '1px solid rgba(168,85,247,0.35)', borderRadius: '20px', boxShadow: '0 32px 64px rgba(0,0,0,0.9)', width: '100%', maxWidth: '420px', padding: '28px', color: '#f8fafc', animation: 'slideIn 0.2s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingBottom: '16px', borderBottom: `1px solid ${COLOR.border}` }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: '#f8fafc', margin: 0 }}>
                <Info size={15} style={{ color: '#a855f7' }} /> Device Info — {sysInfo.name}
              </h3>
              <button className="btn-ghost" style={Btn.ghost} onClick={() => setShowSysModal(false)}><X size={16} /></button>
            </div>

            <div style={{ background: 'rgba(2,6,23,0.9)', borderRadius: '12px', border: `1px solid ${COLOR.border}`, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: 'monospace', fontSize: '12px' }}>
              {[
                ['Protocol', sysInfo.brand === 'hikvision' ? 'Hikvision ISAPI (HTTP Digest)' : 'Dahua CGI (HTTP Basic)'],
                ['Model', sysInfo.system_info?.deviceType || sysInfo.system_info?.model || 'Camera Device'],
                ['Serial', sysInfo.system_info?.serialNumber || 'N/A'],
                ['Firmware', sysInfo.system_info?.firmwareVersion || sysInfo.system_info?.hardwareVersion || '1.00'],
                ['Encoder', sysInfo.system_info?.encoderVersion || 'Standard'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: COLOR.textMuted, minWidth: '70px' }}>{k}</span>
                  <span style={{ color: '#e2e8f0', textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: `1px solid ${COLOR.border}`, marginTop: '4px' }}>
                <span style={{ color: COLOR.textMuted }}>Status</span>
                <span style={{ background: 'rgba(6,78,59,0.5)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)', borderRadius: '6px', padding: '2px 10px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ONLINE</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '20px' }}>
              <button className="btn-primary" style={Btn.primary} onClick={() => setShowSysModal(false)}>Done</button>
            </div>
          </div>
        </Backdrop>,
        document.body
      )}
    </>
  );
}