import React, { useState, useEffect } from 'react';

export default function Caretaker({ user, refreshTrigger, onRefresh }) {
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, submit, history, messages, profile
  const [assignedProperties, setAssignedProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [readingsHistory, setReadingsHistory] = useState([]);
  const [chatPartners, setChatPartners] = useState([]); // In-app messages
  const [activePartnerId, setActivePartnerId] = useState(null);
  const [activeChatMessages, setActiveChatMessages] = useState([]);
  const [newMsgBody, setNewMsgBody] = useState('');
  
  // Submit Reading Form State
  const [submitMode, setSubmitMode] = useState('list'); // 'list' or 'search'
  const [unitSearchQuery, setUnitSearchQuery] = useState('');
  const [bulkReadings, setBulkReadings] = useState({});
  const [bulkNotes, setBulkNotes] = useState({});
  const [submittedUnitIds, setSubmittedUnitIds] = useState([]);

  const [propId, setPropId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [meterType, setMeterType] = useState('water');
  const [currentReading, setCurrentReading] = useState('');
  const [prevReading, setPrevReading] = useState(0);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const headers = {};

  useEffect(() => {
    fetchData();
  }, [activeTab, refreshTrigger]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'dashboard') {
        const [resProps, resReadings] = await Promise.all([
          fetch('/api/properties', { headers }),
          fetch('/api/meter-readings', { headers })
        ]);
        setAssignedProperties(await resProps.json());
        const readings = await resReadings.json();
        setReadingsHistory(readings.filter(r => r.submitted_by === user.id));
      } else if (activeTab === 'submit') {
        const [resProps, resUnits, resReadings] = await Promise.all([
          fetch('/api/properties', { headers }),
          fetch('/api/units', { headers }),
          fetch('/api/meter-readings', { headers })
        ]);
        setAssignedProperties(await resProps.json());
        setUnits(await resUnits.json());
        setReadingsHistory(await resReadings.json());
      } else if (activeTab === 'history') {
        const res = await fetch('/api/meter-readings', { headers });
        const readings = await res.json();
        setReadingsHistory(readings.filter(r => r.submitted_by === user.id));
      } else if (activeTab === 'messages') {
        const res = await fetch('/api/messages', { headers });
        const chats = await res.json();
        setChatPartners(chats);
        if (chats.length > 0 && !activePartnerId) {
          handleOpenChat(chats[0]);
        }
      }
    } catch (e) {
      console.error(e);
      setError('Failed to load caretaker data.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChat = async (chat) => {
    setActivePartnerId(chat.partner_id);
    setActiveChatMessages(chat.messages);

    // Mark as read
    try {
      await fetch('/api/messages/read', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: chat.partner_id })
      });
    } catch (_) {}
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMsgBody.trim()) return;

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_user_id: activePartnerId,
          message_body: newMsgBody
        })
      });

      if (res.ok) {
        const newMsg = await res.json();
        setActiveChatMessages([...activeChatMessages, newMsg]);
        setNewMsgBody('');
        fetchData();
      }
    } catch (e) {
      setError('Failed to send message.');
    }
  };

  const handlePropertyChange = (val) => {
    setPropId(val);
    setUnitId('');
    setPrevReading(0);
  };

  const getPrevReadingForUnit = (uId) => {
    if (!readingsHistory || readingsHistory.length === 0) return 0;
    const matches = readingsHistory.filter(r => r.unit_id === parseInt(uId) && r.meter_type === meterType);
    if (matches.length === 0) return 0;
    const sorted = [...matches].sort((a, b) => new Date(b.reading_date) - new Date(a.reading_date));
    return sorted[0].current_reading;
  };

  const handleUnitChange = (val) => {
    setUnitId(val);
    setPrevReading(getPrevReadingForUnit(val));
  };

  const submitReading = async (pId, uId, val, notesText) => {
    setError('');
    const body = {
      property_id: parseInt(pId),
      unit_id: parseInt(uId),
      meter_type: meterType,
      current_reading: val,
      notes: notesText || ''
    };

    const res = await fetch('/api/meter-readings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit reading.');
    return data;
  };

  const handleInlineSubmit = async (uId, pId) => {
    const readingVal = bulkReadings[uId];
    if (!readingVal) {
      alert('Please enter a reading value.');
      return;
    }

    const prevVal = getPrevReadingForUnit(uId);
    if (parseInt(readingVal) < prevVal) {
      alert(`Current reading cannot be lower than the previous reading of ${prevVal}.`);
      return;
    }

    setLoading(true);
    try {
      await submitReading(pId, uId, parseInt(readingVal), bulkNotes[uId]);
      setSubmittedUnitIds(prev => [...prev, parseInt(uId)]);
      alert(`Unit reading submitted successfully!`);
      fetchData(); // Refresh history and units state
    } catch (err) {
      alert(err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReadingSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const prevVal = getPrevReadingForUnit(unitId);
    const currVal = parseInt(currentReading);

    if (isNaN(currVal) || currVal < 0) {
      setError('Please enter a valid positive meter reading.');
      setLoading(false);
      return;
    }

    if (currVal < prevVal) {
      setError(`Current reading cannot be lower than the previous reading of ${prevVal}.`);
      setLoading(false);
      return;
    }

    try {
      await submitReading(propId, unitId, currVal, notes);
      alert('Meter reading submitted successfully!');
      setActiveTab('history');
      setPropId('');
      setUnitId('');
      setCurrentReading('');
      setNotes('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* TABS NAVBAR */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px', background: 'var(--bg-surface)' }}>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'dashboard' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'dashboard' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
          onClick={() => { setActiveTab('dashboard'); setActivePartnerId(null); }}
        >
          Dashboard
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'submit' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'submit' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
          onClick={() => { setActiveTab('submit'); setActivePartnerId(null); }}
        >
          New Reading
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'history' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'history' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
          onClick={() => { setActiveTab('history'); setActivePartnerId(null); }}
        >
          History
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'messages' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'messages' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
          onClick={() => setActiveTab('messages')}
        >
          Messages
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'profile' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'profile' ? '2px solid var(--primary)' : 'none', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}
          onClick={() => { setActiveTab('profile'); setActivePartnerId(null); }}
        >
          Profile
        </button>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>⚠️ {error}</div>}

      {/* DASHBOARD VIEW */}
      {activeTab === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div className="card" style={{ background: 'linear-gradient(135deg, var(--bg-surface), var(--primary-glow))' }}>
            <p className="kpi-lbl">Caretaker Account</p>
            <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--font-title)' }}>{user.name}</h2>
            <div style={{ marginTop: '10px' }}>
              <span className="badge badge-success">assigned staff</span>
            </div>
          </div>

          <div className="card">
            <h4 className="card-title">My Assignments</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              {assignedProperties.map(p => (
                <div key={p.id} style={{ fontSize: '13px', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  🏢 <strong>{p.name}</strong> • 📍 {p.location}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h4 className="card-title">Recent Submissions</h4>
            {readingsHistory.slice(0, 3).map(read => (
              <div key={read.id} className="flex-row" style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>Unit {read.unit_code} ({read.meter_type.toUpperCase()})</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Reading: {read.current_reading} • {new Date(read.reading_date).toLocaleDateString()}</div>
                </div>
                <span className={`badge ${read.status === 'approved' || read.status === 'billed' ? 'badge-success' : 'badge-warning'}`}>
                  {read.status}
                </span>
              </div>
            ))}
          </div>

        </div>
      )}

      {/* NEW METER READING VIEW */}
      {activeTab === 'submit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Segment Selector */}
          <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-surface-elevated)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <button
              type="button"
              style={{
                flex: 1,
                background: submitMode === 'list' ? 'var(--primary)' : 'none',
                color: submitMode === 'list' ? 'white' : 'var(--text-secondary)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => setSubmitMode('list')}
            >
              📋 Unit List Keying
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                background: submitMode === 'search' ? 'var(--primary)' : 'none',
                color: submitMode === 'search' ? 'white' : 'var(--text-secondary)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onClick={() => setSubmitMode('search')}
            >
              🔍 Search Unit Code
            </button>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📝 Submit readings</span>
              <span className="badge badge-info" style={{ textTransform: 'uppercase', fontSize: '9px' }}>{meterType}</span>
            </h3>
            
            {/* Meter Type selection */}
            <div className="form-group" style={{ marginBottom: '16px', background: 'var(--bg-surface-elevated)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)' }}>
              <label className="form-label" style={{ fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>Meter Type</label>
              <div style={{ display: 'flex', gap: '20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: meterType === 'water' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: meterType === 'water' ? '600' : 'normal' }}>
                  <input
                    type="radio"
                    name="meter_type_radio"
                    value="water"
                    checked={meterType === 'water'}
                    onChange={() => {
                      setMeterType('water');
                      setUnitId('');
                    }}
                  />
                  💧 Water Meter
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: meterType === 'electricity' ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: meterType === 'electricity' ? '600' : 'normal' }}>
                  <input
                    type="radio"
                    name="meter_type_radio"
                    value="electricity"
                    checked={meterType === 'electricity'}
                    onChange={() => {
                      setMeterType('electricity');
                      setUnitId('');
                    }}
                  />
                  ⚡ Electricity Meter
                </label>
              </div>
            </div>

            {/* List Mode View */}
            {submitMode === 'list' && (
              <>
                <div className="form-group">
                  <label className="form-label">Select Assigned Property</label>
                  <select required className="form-control" value={propId} onChange={e => handlePropertyChange(e.target.value)}>
                    <option value="">-- Select Property --</option>
                    {assignedProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {propId && (
                  <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h4 style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>Units for Property</h4>
                    
                    {units.filter(u => u.property_id === parseInt(propId) && !u.deleted_at).length === 0 ? (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>No units found in this property.</p>
                    ) : (
                      units.filter(u => u.property_id === parseInt(propId) && !u.deleted_at)
                        .map(u => {
                          const prevVal = getPrevReadingForUnit(u.id);
                          const isSubmitted = submittedUnitIds.includes(u.id);
                          const currentVal = bulkReadings[u.id] || '';
                          const noteVal = bulkNotes[u.id] || '';

                          return (
                            <div key={u.id} className="card" style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', padding: '12px', margin: '0', borderRadius: '8px' }}>
                              <div className="flex-row">
                                <div>
                                  <strong style={{ fontSize: '14px' }}>Unit {u.unit_code}</strong>
                                  <span style={{ marginLeft: '8px', fontSize: '11px', color: u.status === 'occupied' ? 'var(--success)' : 'var(--text-muted)' }}>
                                    {u.status === 'occupied' ? `👤 ${u.tenant_name || 'Occupied'}` : 'Vacant'}
                                  </span>
                                </div>
                                {isSubmitted ? (
                                  <span className="badge badge-success">✓ Submitted</span>
                                ) : (
                                  <span className="badge badge-warning" style={{ fontSize: '9px' }}>Pending</span>
                                )}
                              </div>

                              {!isSubmitted && (
                                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  <div className="grid-2" style={{ gap: '8px', alignItems: 'center' }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                      Previous: <strong style={{ color: 'var(--text-main)' }}>{prevVal}</strong>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <input
                                        type="number"
                                        className="form-control"
                                        style={{ padding: '6px 8px', fontSize: '13px' }}
                                        placeholder={`Current (>${prevVal})`}
                                        value={currentVal}
                                        onChange={e => setBulkReadings({ ...bulkReadings, [u.id]: e.target.value })}
                                      />
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                      type="text"
                                      className="form-control"
                                      style={{ padding: '6px 8px', fontSize: '12px', flex: 1 }}
                                      placeholder="Notes (optional)"
                                      value={noteVal}
                                      onChange={e => setBulkNotes({ ...bulkNotes, [u.id]: e.target.value })}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      style={{ padding: '6px 12px' }}
                                      onClick={() => handleInlineSubmit(u.id, propId)}
                                      disabled={loading}
                                    >
                                      Submit
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </>
            )}

            {/* Search Mode View */}
            {submitMode === 'search' && (
              <>
                <div className="form-group">
                  <label className="form-label">Type Unit Code / Number</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search e.g. A1, A2, G01..."
                    value={unitSearchQuery}
                    onChange={e => setUnitSearchQuery(e.target.value)}
                  />
                </div>

                {unitSearchQuery && (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {units.filter(u => !u.deleted_at && u.unit_code.toLowerCase().includes(unitSearchQuery.toLowerCase()))
                      .slice(0, 5)
                      .map(u => {
                        const prevVal = getPrevReadingForUnit(u.id);
                        const isSubmitted = submittedUnitIds.includes(u.id);
                        const currentVal = bulkReadings[u.id] || '';
                        const noteVal = bulkNotes[u.id] || '';
                        const prop = assignedProperties.find(p => p.id === u.property_id);

                        return (
                          <div key={u.id} className="card" style={{ background: 'var(--bg-surface-elevated)', border: '1px solid var(--border)', padding: '12px', margin: '0', borderRadius: '8px' }}>
                            <div className="flex-row">
                              <div>
                                <strong style={{ fontSize: '14px' }}>Unit {u.unit_code}</strong>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                  ({prop ? prop.name : 'Property'})
                                </span>
                                <div style={{ fontSize: '11px', color: u.status === 'occupied' ? 'var(--success)' : 'var(--text-muted)', marginTop: '2px' }}>
                                  {u.status === 'occupied' ? `👤 Tenant: ${u.tenant_name || 'Occupied'}` : 'Vacant'}
                                </div>
                              </div>
                              {isSubmitted ? (
                                <span className="badge badge-success">✓ Submitted</span>
                              ) : (
                                <span className="badge badge-warning" style={{ fontSize: '9px' }}>Pending</span>
                              )}
                            </div>

                            {!isSubmitted && (
                              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div className="grid-2" style={{ gap: '8px', alignItems: 'center' }}>
                                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    Previous: <strong style={{ color: 'var(--text-main)' }}>{prevVal}</strong>
                                  </div>
                                  <div>
                                    <input
                                      type="number"
                                      className="form-control"
                                      style={{ padding: '6px 8px', fontSize: '13px' }}
                                      placeholder={`Current (>${prevVal})`}
                                      value={currentVal}
                                      onChange={e => setBulkReadings({ ...bulkReadings, [u.id]: e.target.value })}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <input
                                    type="text"
                                    className="form-control"
                                    style={{ padding: '6px 8px', fontSize: '12px', flex: 1 }}
                                    placeholder="Notes (optional)"
                                    value={noteVal}
                                    onChange={e => setBulkNotes({ ...bulkNotes, [u.id]: e.target.value })}
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    style={{ padding: '6px 12px' }}
                                    onClick={() => handleInlineSubmit(u.id, u.property_id)}
                                    disabled={loading}
                                  >
                                    Submit
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    }
                    {units.filter(u => !u.deleted_at && u.unit_code.toLowerCase().includes(unitSearchQuery.toLowerCase())).length === 0 && (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px' }}>No matching units found.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* READINGS HISTORY VIEW */}
      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {readingsHistory.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px' }}>No submissions found.</p>
          ) : (
            readingsHistory.map(read => (
              <div key={read.id} className="card">
                <div className="flex-row">
                  <span className="badge badge-info">{read.meter_type.toUpperCase()}</span>
                  <span className={`badge ${read.status === 'approved' || read.status === 'billed' ? 'badge-success' : 'badge-warning'}`}>{read.status}</span>
                </div>
                <h3 className="card-title" style={{ margin: '6px 0 2px 0' }}>Unit {read.unit_code} ({read.property_name})</h3>
                <div style={{ fontSize: '12px', marginTop: '4px' }}>
                  Date: {read.reading_date}
                </div>
                
                <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                
                <div className="grid-3" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', background: 'var(--bg-surface-elevated)', padding: '8px', borderRadius: '4px' }}>
                  <span>Prev: <strong>{read.previous_reading}</strong></span>
                  <span>Current: <strong>{read.current_reading}</strong></span>
                  <span>Usage: <strong>{read.usage}</strong></span>
                </div>
                {read.notes && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>Note: {read.notes}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {/* MESSAGES / CHATS VIEW */}
      {activeTab === 'messages' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '12px' }}>
          {chatPartners.length === 0 ? (
            <p style={{ textAlign: 'center', padding: '20px' }}>No active conversations.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* Partner Select list */}
              {!activePartnerId ? (
                chatPartners.map(chat => (
                  <div key={chat.partner_id} className="card" style={{ cursor: 'pointer' }} onClick={() => handleOpenChat(chat)}>
                    <div className="flex-row">
                      <strong style={{ fontSize: '14px' }}>{chat.partner_name}</strong>
                      {chat.unread_count > 0 && <span className="badge badge-danger">{chat.unread_count} new</span>}
                    </div>
                    <p style={{ fontSize: '12px', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.last_message}</p>
                  </div>
                ))
              ) : (
                /* Active Chat Window */
                <div className="chat-window">
                  <div className="flex-row" style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <strong>💬 Landlord: Maina Kamau</strong>
                    <button className="btn btn-secondary btn-sm" onClick={() => setActivePartnerId(null)}>Close Chat</button>
                  </div>

                  <div className="chat-history">
                    {activeChatMessages.map(msg => (
                      <div
                        key={msg.id}
                        className={`chat-bubble ${msg.sender_user_id === user.id ? 'bubble-sender' : 'bubble-recipient'}`}
                      >
                        {msg.message_body}
                        <div style={{ fontSize: '9px', textAlign: 'right', marginTop: '4px', opacity: 0.8 }}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleSendMessage} className="chat-input-bar">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Type message body..."
                      value={newMsgBody}
                      onChange={e => setNewMsgBody(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Send</button>
                  </form>
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* PROFILE VIEW WITH SHORTCUT CONTACT ACTIONS */}
      {activeTab === 'profile' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          <div className="card" style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '64px' }}>👤</span>
            <h2 style={{ fontSize: '22px', marginTop: '10px' }}>{user.name}</h2>
            <p style={{ fontSize: '13px' }}>Role: Caretaker</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Email: {user.email} • Phone: {user.phone_number}</p>
          </div>

          <div className="card">
            <h4 className="card-title">Contact Landlord (Demo Shortcuts)</h4>
            <p style={{ fontSize: '12px', marginBottom: '14px' }}>Quick links to initiate contact with the Property Landlord.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a href={`tel:${user.phone_number}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                📞 Call Landlord Direct
              </a>
              <a href="https://wa.me/254712345678" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                💬 WhatsApp Message
              </a>
              <a href={`sms:${user.phone_number}`} className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                ✉️ Send SMS Message
              </a>
            </div>
          </div>

        </div>
      )}

    </div>
  );
}
