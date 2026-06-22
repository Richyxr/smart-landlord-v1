import React, { useState, useEffect } from 'react';
import { Building2, Home, MapPin, DoorOpen, User, Phone, Mail, CreditCard, Calendar, Wrench, Plus, Check } from 'lucide-react';

export default function Properties({ organization, refreshTrigger, onRefresh, initialSubTab, clearInitialSubTab }) {
  const [activeTab, setActiveTab] = useState(initialSubTab || 'properties'); // properties, units, tenants, caretakers

  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(initialSubTab);
      clearInitialSubTab?.();
    }
  }, [initialSubTab]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [caretakers, setCaretakers] = useState([]);
  
  // Form Toggles & State
  const [showAddForm, setShowAddForm] = useState(false);
  const [editId, setEditId] = useState(null);
  
  // Property Form State
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState('Apartment');
  const [location, setLocation] = useState('');
  const [county, setCounty] = useState('Nairobi');
  const [town, setTown] = useState('Nairobi');
  const [notes, setNotes] = useState('');

  // Unit Form State
  const [selectedPropId, setSelectedPropId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitType, setUnitType] = useState('2 Bedroom');
  const [rentAmount, setRentAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [floor, setFloor] = useState('');
  const [block, setBlock] = useState('');
  const [unitNotes, setUnitNotes] = useState('');

  // Tenant Form State
  const [tenantPropId, setTenantPropId] = useState('');
  const [tenantUnitId, setTenantUnitId] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [tenantEmail, setTenantEmail] = useState('');
  const [tenantIdNum, setTenantIdNum] = useState('');
  const [moveInDate, setMoveInDate] = useState(new Date().toISOString().split('T')[0]);
  const [tenantRent, setTenantRent] = useState('');
  const [billingDay, setBillingDay] = useState('1');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [tenantNotes, setTenantNotes] = useState('');

  // Caretaker Form State
  const [ctEmail, setCtEmail] = useState('');
  const [ctName, setCtName] = useState('');
  const [ctPhone, setCtPhone] = useState('');
  const [ctAssignedProps, setCtAssignedProps] = useState([]); // Array of property IDs

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
      if (activeTab === 'properties') {
        const res = await fetch('/api/properties', { headers });
        const data = await res.json();
        setProperties(data);
      } else if (activeTab === 'units') {
        const [resUnits, resProps] = await Promise.all([
          fetch('/api/units', { headers }),
          fetch('/api/properties', { headers })
        ]);
        const dataUnits = await resUnits.json();
        const dataProps = await resProps.json();
        setUnits(dataUnits);
        setProperties(dataProps);
      } else if (activeTab === 'tenants') {
        const [resTenants, resProps, resUnits] = await Promise.all([
          fetch('/api/tenants', { headers }),
          fetch('/api/properties', { headers }),
          fetch('/api/units', { headers })
        ]);
        const dataTenants = await resTenants.json();
        setTenants(dataTenants);
        setProperties(await resProps.json());
        setUnits(await resUnits.json());
      } else if (activeTab === 'caretakers') {
        const [resProps, resCt] = await Promise.all([
          fetch('/api/properties', { headers }),
          fetch('/api/properties/caretakers', { headers })
        ]);
        setProperties(await resProps.json());
        setCaretakers(await resCt.json());
      }
    } catch (e) {
      setError('Failed to fetch data.');
    } finally {
      setLoading(false);
    }
  };

  const handlePropertySubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!propertyName.trim() || !location.trim()) {
      setError('Property Name and Location are required.');
      setLoading(false);
      return;
    }

    const body = { name: propertyName, property_type: propertyType, location, county, town, notes };
    const url = editId ? `/api/properties/${editId}` : '/api/properties';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Save property failed.');
      
      setShowAddForm(false);
      setEditId(null);
      resetPropertyForm();
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnitSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!selectedPropId) {
      setError('Please select a property.');
      setLoading(false);
      return;
    }
    if (!unitCode.trim()) {
      setError('Unit Code is required.');
      setLoading(false);
      return;
    }
    if (parseFloat(rentAmount) <= 0) {
      setError('Rent amount must be a positive number.');
      setLoading(false);
      return;
    }
    if (depositAmount && parseFloat(depositAmount) < 0) {
      setError('Security deposit cannot be negative.');
      setLoading(false);
      return;
    }

    const body = {
      property_id: selectedPropId,
      unit_code: unitCode,
      unit_type: unitType,
      rent_amount: rentAmount,
      deposit_amount: depositAmount || rentAmount,
      floor,
      block,
      notes: unitNotes
    };

    const url = editId ? `/api/units/${editId}` : '/api/units';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Save unit failed.');

      setShowAddForm(false);
      setEditId(null);
      resetUnitForm();
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!tenantPropId || !tenantUnitId) {
      setError('Please select a property and a unit.');
      setLoading(false);
      return;
    }
    if (!tenantName.trim()) {
      setError('Tenant name is required.');
      setLoading(false);
      return;
    }
    if (!phoneRegex.test(tenantPhone)) {
      setError('Phone Number must be in E.164 format (e.g. +254712345678).');
      setLoading(false);
      return;
    }
    if (!emailRegex.test(tenantEmail)) {
      setError('Invalid email address format.');
      setLoading(false);
      return;
    }
    if (parseFloat(tenantRent) <= 0) {
      setError('Assigned rent amount must be a positive number.');
      setLoading(false);
      return;
    }
    const billingDayInt = parseInt(billingDay);
    if (isNaN(billingDayInt) || billingDayInt < 1 || billingDayInt > 28) {
      setError('Billing Day must be between 1 and 28.');
      setLoading(false);
      return;
    }
    if (emergencyPhone && !phoneRegex.test(emergencyPhone)) {
      setError('Emergency contact phone must be in E.164 format (e.g. +254712345678).');
      setLoading(false);
      return;
    }

    const body = {
      property_id: tenantPropId,
      unit_id: tenantUnitId,
      full_name: tenantName,
      phone_number: tenantPhone,
      email: tenantEmail,
      id_number: tenantIdNum,
      move_in_date: moveInDate,
      rent_amount: tenantRent,
      billing_day: billingDay,
      emergency_contact_name: emergencyName,
      emergency_contact_phone: emergencyPhone,
      notes: tenantNotes
    };

    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error('Add tenant failed.');

      setShowAddForm(false);
      resetTenantForm();
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVacateTenant = async (id) => {
    if (!window.confirm('Are you sure you want to vacate this tenant? This will free the unit and mark the tenant history.')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${id}/vacate`, {
        method: 'POST',
        headers
      });
      if (!res.ok) throw new Error('Vacate tenant failed.');
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteCaretaker = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!ctName.trim()) {
      setError('Caretaker name is required.');
      setLoading(false);
      return;
    }
    if (ctEmail && !emailRegex.test(ctEmail)) {
      setError('Invalid caretaker email address.');
      setLoading(false);
      return;
    }
    if (!phoneRegex.test(ctPhone)) {
      setError('Caretaker phone number must be in E.164 format (e.g. +254722111222).');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/properties/caretakers', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ctName,
          email: ctEmail || null,
          phone_number: ctPhone,
          assigned_properties: ctAssignedProps
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to create caretaker.');
      }

      alert(`Caretaker created successfully!\n\nName: ${data.user.name}\nPhone: ${data.user.phone_number}\nSystem-Generated PIN: ${data.temporary_pin}\n\nIMPORTANT: Please copy and share this PIN with the caretaker. It will not be shown again!`);
      
      setShowAddForm(false);
      setCtEmail('');
      setCtName('');
      setCtPhone('');
      setCtAssignedProps([]);
      fetchData();
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPropertyForm = () => {
    setPropertyName('');
    setPropertyType('Apartment');
    setLocation('');
    setNotes('');
  };

  const resetUnitForm = () => {
    setSelectedPropId('');
    setUnitCode('');
    setRentAmount('');
    setDepositAmount('');
    setFloor('');
    setBlock('');
    setUnitNotes('');
  };

  const resetTenantForm = () => {
    setTenantPropId('');
    setTenantUnitId('');
    setTenantName('');
    setTenantPhone('');
    setTenantEmail('');
    setTenantIdNum('');
    setTenantRent('');
    setEmergencyName('');
    setEmergencyPhone('');
    setTenantNotes('');
  };

  // Helpers
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency: organization.billing_currency || 'KES', maximumFractionDigits: 0 }).format(val);
  };

  const getVacantUnitsForProp = (propId) => {
    const selectedPropertyId = String(propId ?? '');
    return units.filter(u => {
      const unitPropertyId = String(
        u.property_id ??
        u.propertyId ??
        u.property?.id ??
        ''
      );
      const unitStatus = String(u.status ?? '').toLowerCase();
      const isDeleted = u.deleted_at !== null && u.deleted_at !== undefined;
      return unitPropertyId === selectedPropertyId && unitStatus === 'vacant' && !isDeleted;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      
      {/* TABS HEADER */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '16px', background: 'var(--bg-surface)' }}>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'properties' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'properties' ? '2px solid var(--primary)' : 'none', fontWeight: '600', cursor: 'pointer' }}
          onClick={() => { setActiveTab('properties'); setShowAddForm(false); setEditId(null); }}
        >
          Properties
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'units' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'units' ? '2px solid var(--primary)' : 'none', fontWeight: '600', cursor: 'pointer' }}
          onClick={() => { setActiveTab('units'); setShowAddForm(false); setEditId(null); }}
        >
          Units
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'tenants' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'tenants' ? '2px solid var(--primary)' : 'none', fontWeight: '600', cursor: 'pointer' }}
          onClick={() => { setActiveTab('tenants'); setShowAddForm(false); setEditId(null); }}
        >
          Tenants
        </button>
        <button
          style={{ flex: 1, padding: '12px 0', border: 'none', background: 'none', color: activeTab === 'caretakers' ? 'var(--primary)' : 'var(--text-secondary)', borderBottom: activeTab === 'caretakers' ? '2px solid var(--primary)' : 'none', fontWeight: '600', cursor: 'pointer' }}
          onClick={() => { setActiveTab('caretakers'); setShowAddForm(false); setEditId(null); }}
        >
          Staff
        </button>
      </div>

      {error && <div role="alert" style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '16px', fontWeight: 'bold' }}>{error}</div>}

      {/* RENDER FORMS */}
      {showAddForm && (
        <div className="card">
          <h3 className="card-title">{editId ? 'Edit' : 'Add New'} {activeTab.slice(0,-1)}</h3>
          
          {/* PROPERTY FORM */}
          {activeTab === 'properties' && (
            <form onSubmit={handlePropertySubmit}>
              <div className="form-group">
                <label className="form-label">Property Name</label>
                <input type="text" required className="form-control" placeholder="Sunset Heights" value={propertyName} onChange={e => setPropertyName(e.target.value)} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-control" value={propertyType} onChange={e => setPropertyType(e.target.value)}>
                    <option value="Apartment">Apartment</option>
                    <option value="Bedsitter block">Bedsitter block</option>
                    <option value="Hostel">Hostel</option>
                    <option value="Mixed-use">Mixed-use</option>
                    <option value="Commercial">Commercial</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input type="text" required className="form-control" placeholder="Kilimani" value={location} onChange={e => setLocation(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea className="form-control" rows="2" placeholder="Description details..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              <div className="flex-gap" style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddForm(false); setEditId(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Property'}</button>
              </div>
            </form>
          )}

          {/* UNIT FORM */}
          {activeTab === 'units' && (
            <form onSubmit={handleUnitSubmit}>
              <div className="form-group">
                <label className="form-label">Belongs to Property</label>
                <select required className="form-control" value={selectedPropId} onChange={e => setSelectedPropId(e.target.value)}>
                  <option value="">-- Select Property --</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Unit Code / No.</label>
                  <input type="text" required className="form-control" placeholder="A1" value={unitCode} onChange={e => setUnitCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit Type</label>
                  <select className="form-control" value={unitType} onChange={e => setUnitType(e.target.value)}>
                    <option value="Single Room">Single Room</option>
                    <option value="Bedsitter">Bedsitter</option>
                    <option value="1 Bedroom">1 Bedroom</option>
                    <option value="2 Bedroom">2 Bedroom</option>
                    <option value="3 Bedroom">3 Bedroom</option>
                  </select>
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Monthly Rent Amount</label>
                  <input type="number" required className="form-control" placeholder="30000" value={rentAmount} onChange={e => setRentAmount(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Security Deposit</label>
                  <input type="number" className="form-control" placeholder="30000" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} />
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Floor</label>
                  <input type="text" className="form-control" placeholder="1st" value={floor} onChange={e => setFloor(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Block / Wing</label>
                  <input type="text" className="form-control" placeholder="Block A" value={block} onChange={e => setBlock(e.target.value)} />
                </div>
              </div>
              <div className="flex-gap" style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowAddForm(false); setEditId(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Unit'}</button>
              </div>
            </form>
          )}

          {/* TENANT FORM */}
          {activeTab === 'tenants' && (
            <form onSubmit={handleTenantSubmit}>
              <div className="form-group">
                <label className="form-label">Select Property</label>
                <select required className="form-control" value={tenantPropId} onChange={e => { setTenantPropId(e.target.value); setTenantUnitId(''); }}>
                  <option value="">-- Select Property --</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              
              {tenantPropId && (
                <div className="form-group">
                  <label className="form-label">Select Vacant Unit</label>
                  <select required className="form-control" value={tenantUnitId} onChange={e => {
                    setTenantUnitId(e.target.value);
                    const unit = units.find(u => String(u.id ?? '') === String(e.target.value));
                    if (unit) setTenantRent(unit.rent_amount);
                  }}>
                    <option value="">-- Select Unit --</option>
                    {getVacantUnitsForProp(tenantPropId).map(u => (
                      <option key={u.id} value={u.id}>{u.unit_code} ({u.unit_type} - KES {u.rent_amount})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Tenant Full Name</label>
                <input type="text" required className="form-control" placeholder="John Mwangi" value={tenantName} onChange={e => setTenantName(e.target.value)} />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Phone Number</label>
                  <input type="tel" required className="form-control" placeholder="+254712345678" value={tenantPhone} onChange={e => setTenantPhone(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input type="email" required className="form-control" placeholder="mwangi@demo.com" value={tenantEmail} onChange={e => setTenantEmail(e.target.value)} />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">National ID / Passport</label>
                  <input type="text" className="form-control" placeholder="3248910" value={tenantIdNum} onChange={e => setTenantIdNum(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Move-in Date</label>
                  <input type="date" required className="form-control" value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
                </div>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Assigned Rent Amount</label>
                  <input type="number" required className="form-control" placeholder="30000" value={tenantRent} onChange={e => setTenantRent(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Monthly Billing Day</label>
                  <input type="number" required className="form-control" min="1" max="28" value={billingDay} onChange={e => setBillingDay(e.target.value)} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
              <p className="form-label" style={{ marginBottom: '8px' }}>Emergency Contact</p>
              
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input type="text" className="form-control" placeholder="Parent / Spouse" value={emergencyName} onChange={e => setEmergencyName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone No.</label>
                  <input type="tel" className="form-control" placeholder="+254700..." value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
                </div>
              </div>

              <div className="flex-gap" style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Add & Occupy Unit'}</button>
              </div>
            </form>
          )}

          {/* CARETAKER FORM */}
          {activeTab === 'caretakers' && (
            <form onSubmit={handleInviteCaretaker}>
              <div className="form-group">
                <label className="form-label">Caretaker Name</label>
                <input type="text" required className="form-control" placeholder="Juma Omondi" value={ctName} onChange={e => setCtName(e.target.value)} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input type="email" className="form-control" placeholder="juma@demo.com (optional)" value={ctEmail} onChange={e => setCtEmail(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input type="tel" required className="form-control" placeholder="+254722..." value={ctPhone} onChange={e => setCtPhone(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Assign to Properties</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '120px', overflowY: 'auto', padding: '6px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                  {properties.map(p => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                      <input 
                        type="checkbox" 
                        checked={ctAssignedProps.includes(p.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setCtAssignedProps([...ctAssignedProps, p.id]);
                          } else {
                            setCtAssignedProps(ctAssignedProps.filter(id => id !== p.id));
                          }
                        }}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex-gap" style={{ marginTop: '12px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Send Invite & Assign</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* QUICK ADD BUTTON */}
      {!showAddForm && (
        <button
          className="btn btn-primary"
          style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}
          onClick={() => {
            setShowAddForm(true);
            setEditId(null);
            resetPropertyForm();
            resetUnitForm();
            resetTenantForm();
          }}
        >
          <Plus size={14} /> Add {activeTab.charAt(0).toUpperCase() + activeTab.slice(1, -1)}
        </button>
      )}

      {/* RENDER LISTS */}
      {loading && <p style={{ textAlign: 'center' }}>Loading List...</p>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          {/* PROPERTIES LIST */}
          {activeTab === 'properties' && (
            properties.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Building2 size={32} style={{ marginBottom: '8px', color: 'var(--text-secondary)' }} />
                No rental properties registered yet. Click the button above to add your first property.
              </div>
            ) : (
              properties.map(p => (
                <div key={p.id} className="card">
                  <div className="flex-row">
                    <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Home size={18} style={{ color: 'var(--primary)' }} />
                      <span>{p.name}</span>
                    </h3>
                    <span className="badge badge-info">{p.property_type}</span>
                  </div>
                  <p style={{ fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MapPin size={12} style={{ color: 'var(--info)' }} />
                    <span>{p.location}</span>
                  </p>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '12px', background: 'var(--bg-surface-elevated)', padding: '8px', borderRadius: '6px' }}>
                    <span>Occupied: <strong>{p.occupied_units}</strong></span>
                    <span>Vacant: <strong>{p.vacant_units}</strong></span>
                    <span>Expected: <strong>{formatCurrency(p.expected_rent)}</strong></span>
                  </div>

                  {p.notes && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>Note: {p.notes}</p>}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      setEditId(p.id);
                      setPropertyName(p.name);
                      setPropertyType(p.property_type);
                      setLocation(p.location);
                      setNotes(p.notes || '');
                      setShowAddForm(true);
                    }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={async () => {
                      if (window.confirm('Delete property? All child units will be soft-deleted.')) {
                        await fetch(`/api/properties/${p.id}`, { method: 'DELETE', headers });
                        fetchData();
                        onRefresh();
                      }
                    }}>Delete</button>
                  </div>
                </div>
              ))
            )
          )}

          {/* UNITS LIST */}
          {activeTab === 'units' && (
            units.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <DoorOpen size={32} style={{ marginBottom: '8px', color: 'var(--text-secondary)' }} />
                No rental units registered yet. Click the button above to add your first unit.
              </div>
            ) : (
              units.map(u => (
                <div key={u.id} className="card">
                  <div className="flex-row">
                    <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <DoorOpen size={18} style={{ color: 'var(--primary)' }} />
                      <span>Unit {u.unit_code}</span>
                    </h3>
                    <span className={`badge ${
                      String(u.status || '').toLowerCase() === 'occupied' ? 'badge-success' : 
                      String(u.status || '').toLowerCase() === 'vacant' ? 'badge-info' : 'badge-warning'
                    }`}>{u.status}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Property: <strong>{u.property_name}</strong> • Type: {u.unit_type}</p>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                    <span style={{ fontSize: '13px' }}>Rent: <strong style={{ color: 'var(--success)' }}>{formatCurrency(u.rent_amount)}</strong></span>
                    <span style={{ fontSize: '12px' }}>Tenant: <strong>{u.tenant_name}</strong></span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      setEditId(u.id);
                      setSelectedPropId(u.property_id);
                      setUnitCode(u.unit_code);
                      setUnitType(u.unit_type);
                      setRentAmount(u.rent_amount);
                      setDepositAmount(u.deposit_amount);
                      setFloor(u.floor || '');
                      setBlock(u.block || '');
                      setUnitNotes(u.notes || '');
                      setShowAddForm(true);
                    }}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={async () => {
                      if (window.confirm('Delete unit? Tenant will be vacated.')) {
                        await fetch(`/api/units/${u.id}`, { method: 'DELETE', headers });
                        fetchData();
                        onRefresh();
                      }
                    }}>Delete</button>
                  </div>
                </div>
              ))
            )
          )}

          {/* TENANTS LIST */}
          {activeTab === 'tenants' && (
            tenants.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <User size={32} style={{ marginBottom: '8px', color: 'var(--text-secondary)' }} />
                No active tenants registered. Click the button above to occupy a vacant unit and add a tenant.
              </div>
            ) : (
              tenants.map(t => (
                <div key={t.id} className="card">
                  <div className="flex-row">
                    <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={18} style={{ color: 'var(--primary)' }} />
                      <span>{t.full_name}</span>
                    </h3>
                    <span className={`badge ${t.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{t.status}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Unit: <strong>{t.unit_code}</strong> ({t.property_name})
                  </p>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={12} style={{ color: 'var(--text-secondary)' }} /> <span>Phone: <strong>{t.phone_number}</strong></span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Mail size={12} style={{ color: 'var(--text-secondary)' }} /> <span>Email: <strong>{t.email}</strong></span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CreditCard size={12} style={{ color: 'var(--text-secondary)' }} /> <span>Account: <strong style={{ color: 'var(--primary)', letterSpacing: '0.5px' }}>{t.tenant_account_number}</strong></span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={12} style={{ color: 'var(--text-secondary)' }} /> <span>Moved In: {t.move_in_date}</span></div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', background: 'var(--bg-surface-elevated)', padding: '8px', borderRadius: '6px' }}>
                    <span style={{ fontSize: '12px' }}>Monthly Rent: <strong>{formatCurrency(t.rent_amount)}</strong></span>
                    <span style={{ fontSize: '12px' }}>Owes: <strong style={{ color: t.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatCurrency(t.balance)}</strong></span>
                  </div>

                  {t.status === 'active' && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
                      <button className="btn btn-danger btn-sm" onClick={() => handleVacateTenant(t.id)}>Vacate Tenant</button>
                    </div>
                  )}
                </div>
              ))
            )
          )}

          {/* STAFF LIST */}
          {activeTab === 'caretakers' && (
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Assign caretakers to specific properties to allow them to submit meter readings and report issues.
              </p>
              {caretakers.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Wrench size={32} style={{ marginBottom: '8px', color: 'var(--text-secondary)' }} />
                  No caretaker staff assigned yet. Send an invitation above.
                </div>
              ) : (
                caretakers.map(ct => (
                  <div key={ct.id} className="card">
                    <div className="flex-row">
                      <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Wrench size={18} style={{ color: 'var(--primary)' }} />
                        <span>{ct.name}</span>
                      </h3>
                      <span className="badge badge-success">assigned</span>
                    </div>
                    <p style={{ fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      {ct.email && <><Mail size={12} style={{ color: 'var(--text-secondary)' }} /> <span>{ct.email}</span> <span>•</span></>}
                      <Phone size={12} style={{ color: 'var(--text-secondary)' }} /> <span>{ct.phone_number}</span>
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Properties: </span>
                      {ct.properties && ct.properties.length > 0 ? (
                        ct.properties.map(p => (
                          <span key={p.id} className="badge badge-info" style={{ fontSize: '10px', padding: '2px 6px' }}>
                            {p.name}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>None assigned</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
