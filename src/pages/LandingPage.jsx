import React, { useState, useEffect } from 'react';
import {
  Building2,
  ShieldCheck,
  Zap,
  Receipt,
  Smartphone,
  Camera,
  BarChart3,
  Users,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Star,
  DollarSign,
  Clock,
  Sparkles,
  Layers,
  ArrowUpRight,
  TrendingUp,
  CreditCard,
  Lock,
  PhoneCall,
  Mail,
  Check,
  Lightbulb,
  Globe,
  Play,
  MapPin,
  Activity,
  Droplet
} from 'lucide-react';

export default function LandingPage({ onGetStarted, onSignIn, onLaunchDemo }) {
  // Dynamic Pricing Configuration from Super Admin
  const [pricingConfig, setPricingConfig] = useState({
    price_per_active_tenant: 75,
    trial_days: 30,
    starter_max_units: 20,
    starter_price_per_unit: 75,
    starter_package_price: 1500,
    growth_max_units: 70,
    growth_price_per_unit: 65,
    growth_package_price: 4500,
    portfolio_price_per_unit: 50,
    portfolio_package_price: 7500
  });

  useEffect(() => {
    fetch('/api/public/pricing')
      .then(res => res.json())
      .then(data => {
        if (data && data.price_per_active_tenant) {
          setPricingConfig(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, []);

  // ROI Calculator State
  const [unitCount, setUnitCount] = useState(25);
  const [avgRent, setAvgRent] = useState(20000);

  // Live Estate Telemetry Inspector State
  const [selectedEstate, setSelectedEstate] = useState(0);
  const [selectedUnitIdx, setSelectedUnitIdx] = useState(0);
  const [simulatedStkState, setSimulatedStkState] = useState('idle'); // 'idle' | 'pushing' | 'paid'

  const handleSimulateStk = () => {
    setSimulatedStkState('pushing');
    setTimeout(() => {
      setSimulatedStkState('paid');
      setTimeout(() => setSimulatedStkState('idle'), 4500);
    }, 1100);
  };

  const estateData = [
    {
      name: 'Kilimani Heights',
      location: 'Argwings Kodhek Rd, Nairobi',
      totalUnits: 36,
      occupancy: '97.2%',
      monthlyRoll: 'KES 1,480,000',
      caretaker: 'Joseph Mwangi (PIN: ••••)',
      units: [
        {
          code: 'Unit A-04',
          tenant: 'Jane Wambui',
          phone: '+254 712 ••• 890',
          rent: 35000,
          waterUsage: '17.7 m³',
          waterBill: 2655,
          powerUsage: '142 kWh',
          powerBill: 3408,
          status: 'Paid',
          lastMpesaRef: 'QK8291KL0P',
          matchTime: '0.28s',
          meterPhotoVerified: true,
          gpsCoords: '-1.2884, 36.7820',
          barrierAccess: 'Allowed · KDA 291M'
        },
        {
          code: 'Unit A-05',
          tenant: 'David Ochieng',
          phone: '+254 722 ••• 419',
          rent: 28000,
          waterUsage: '13.3 m³',
          waterBill: 1995,
          powerUsage: '110 kWh',
          powerBill: 2640,
          status: 'Invoice Dispatched',
          lastMpesaRef: 'Pending STK Push',
          matchTime: 'Auto-Detect Ready',
          meterPhotoVerified: true,
          gpsCoords: '-1.2884, 36.7820',
          barrierAccess: 'Allowed · KCF 884L'
        },
        {
          code: 'Unit B-12',
          tenant: 'Sarah Muthoni',
          phone: '+254 701 ••• 332',
          rent: 42000,
          waterUsage: '19.4 m³',
          waterBill: 2910,
          powerUsage: '165 kWh',
          powerBill: 3960,
          status: 'Paid',
          lastMpesaRef: 'QK9102XB8R',
          matchTime: '0.31s',
          meterPhotoVerified: true,
          gpsCoords: '-1.2884, 36.7820',
          barrierAccess: 'Allowed · KBZ 119Q'
        }
      ]
    },
    {
      name: 'Westlands Square',
      location: 'Muthithi Road, Nairobi',
      totalUnits: 48,
      occupancy: '95.8%',
      monthlyRoll: 'KES 2,640,000',
      caretaker: 'Eric Kimani (PIN: ••••)',
      units: [
        {
          code: 'Unit W-201',
          tenant: 'Brian Omondi',
          phone: '+254 733 ••• 561',
          rent: 55000,
          waterUsage: '22.1 m³',
          waterBill: 3315,
          powerUsage: '210 kWh',
          powerBill: 5040,
          status: 'Paid',
          lastMpesaRef: 'QK7712AA9L',
          matchTime: '0.19s',
          meterPhotoVerified: true,
          gpsCoords: '-1.2642, 36.8044',
          barrierAccess: 'Allowed · KDD 482L'
        },
        {
          code: 'Unit W-202',
          tenant: 'Amina Hassan',
          phone: '+254 711 ••• 702',
          rent: 48000,
          waterUsage: '15.8 m³',
          waterBill: 2370,
          powerUsage: '135 kWh',
          powerBill: 3240,
          status: 'Paid',
          lastMpesaRef: 'QK8940PP3W',
          matchTime: '0.22s',
          meterPhotoVerified: true,
          gpsCoords: '-1.2642, 36.8044',
          barrierAccess: 'Allowed · KCR 302J'
        }
      ]
    }
  ];

  // FAQ Accordion State
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  // CCTV Feed Switcher State
  const [activeCctvFeed, setActiveCctvFeed] = useState('gate');
  const cctvFeeds = {
    gate: { name: 'Main Gate 01', target: 'Vehicle Barrier & ANPR', res: '1080p @ 25 FPS' },
    parking: { name: 'Parking Bay A', target: '28/30 Slots Occupied', res: '1080p @ 25 FPS' },
    lobby: { name: 'Ground Lobby', target: 'Access PIN Entry Door', res: '1080p @ 30 FPS' }
  };

  // Feature Tab State
  const [activeFeature, setActiveFeature] = useState(0);
  const [featuresPaused, setFeaturesPaused] = useState(false);
  const FEATURE_COUNT = 5;
  const CYCLE_MS = 3500;

  useEffect(() => {
    if (featuresPaused) return;
    const timer = setInterval(() => {
      setActiveFeature(prev => (prev + 1) % FEATURE_COUNT);
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, [featuresPaused, activeFeature]);
  const features = [
    {
      icon: Zap,
      label: 'M-Pesa Reconciliation',
      headline: 'Payments match in under a second.',
      body: 'Connect your Safaricom Paybill or Till number. Every incoming M-Pesa and bank transfer is automatically matched to a tenant unit, receipt issued, and arrears updated — with zero manual ledger work.',
      badge: '0.3s Auto-Match',
      badgeColor: '#10b981',
      accentColor: '#10b981',
      accentBg: 'rgba(16, 185, 129, 0.08)',
      preview: 'mpesa'
    },
    {
      icon: Smartphone,
      label: 'Caretaker Field Portal',
      headline: 'Meter reads. From any smartphone.',
      body: 'Field staff log water and electricity meters via a secure 4-digit PIN mobile portal. Each entry is photo-verified and GPS-stamped, generating automatic utility invoices with no disputes.',
      badge: 'Photo + GPS Verified',
      badgeColor: '#38bdf8',
      accentColor: '#38bdf8',
      accentBg: 'rgba(56, 189, 248, 0.08)',
      preview: 'caretaker'
    },
    {
      icon: Receipt,
      label: 'Automated Invoicing',
      headline: '1 click. All invoices. All tenants.',
      body: 'Generate consolidated rent rolls that bundle rent, water, electricity, and service charges. Branded PDF invoices are dispatched via automated SMS with an embedded M-Pesa STK Push payment link.',
      badge: '1-Click Batch Run',
      badgeColor: '#818cf8',
      accentColor: '#818cf8',
      accentBg: 'rgba(99, 102, 241, 0.08)',
      preview: 'invoicing'
    },
    {
      icon: Camera,
      label: 'CCTV & Access Control',
      headline: 'Live surveillance. Built into your dashboard.',
      body: 'Stream RTSP IP cameras directly inside Smart Landlord. Monitor gates, parking bays, and corridors without any external NVR app. ANPR vehicle recognition at barriers comes standard.',
      badge: 'RTSP / ONVIF Live',
      badgeColor: '#f59e0b',
      accentColor: '#f59e0b',
      accentBg: 'rgba(245, 158, 11, 0.08)',
      preview: 'cctv'
    },
    {
      icon: Building2,
      label: 'Portfolio & KRA Tax',
      headline: 'Multi-estate. KRA-ready. Always.',
      body: 'Manage unlimited properties under one login. Assign caretakers per block, track occupancy and arrears across estates, and export KRA eTIMS-validated withholding tax reports in one click.',
      badge: '✓ KRA eTIMS Validated',
      badgeColor: '#10b981',
      accentColor: '#c084fc',
      accentBg: 'rgba(192, 132, 252, 0.08)',
      preview: 'portfolio'
    }
  ];

  // Dynamic Unit Rate based on calibrated boundaries
  const getUnitPrice = (units) => {
    if (units > (pricingConfig.growth_max_units || 70)) return Number(pricingConfig.portfolio_price_per_unit || 50);
    if (units > (pricingConfig.starter_max_units || 20)) return Number(pricingConfig.growth_price_per_unit || 65);
    return Number(pricingConfig.starter_price_per_unit || 75);
  };

  const unitRate = getUnitPrice(unitCount);
  const totalMonthlySoftwareCost = unitCount * unitRate;
  const totalMonthlyRent = unitCount * avgRent;
  const hoursSavedPerMonth = Math.round(unitCount * 0.85);
  const estimatedCollectionBoost = Math.round(totalMonthlyRent * 0.04); // 4% reduced arrears

  const faqs = [
    {
      q: 'How does M-Pesa automated reconciliation work?',
      a: 'Smart Landlord connects directly with Safaricom Daraja API. When a tenant pays via your Paybill or Till number with their unit code as reference, the payment is matched, credited to the tenant balance, and a receipt is instantly generated and SMS-notified without manual ledger entry.'
    },
    {
      q: 'Can caretakers enter water and electricity meter readings on their phones?',
      a: 'Yes! Caretakers have a dedicated mobile-first portal secured with an individual 4-digit PIN. They can log unit water/electricity consumption, snap photo proof of the physical meter, and the system automatically calculates utility bills and appends them to the monthly invoice.'
    },
    {
      q: 'Is my financial data secure?',
      a: 'All data is encrypted in transit and at rest using bank-grade 256-bit encryption. Critical landlord actions (such as voiding invoices or changing banking details) require your secondary Security PIN.'
    },
    {
      q: 'Can I manage multiple properties across different locations?',
      a: 'Yes, Smart Landlord supports multi-property portfolios of any size. You can group units by building, assign different caretakers to each premise, and view combined or isolated financial performance reports.'
    },
    {
      q: 'Can I try Smart Landlord before paying for a subscription?',
      a: 'Yes! We offer a full-featured 14-day free trial on all plans. No credit card is required to create an account and start onboarding your properties.'
    }
  ];

  return (
    <div className="landing-page-root" style={{ background: '#0b0f19', color: '#f8fafc', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* 1. STICKY GLASSMORPHISM NAVBAR */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(11, 15, 25, 0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '14px 24px'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* BRAND LOGO */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <img
              src="/icons/maskable-192.png"
              alt="Smart Landlord Logo"
              style={{ width: '36px', height: '36px', borderRadius: '10px', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}
            />
            <span style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em', color: '#fff' }}>
              Smart <span style={{ color: '#6366f1' }}>Landlord</span>
            </span>
          </div>

          {/* DESKTOP NAV LINKS */}
          <nav className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '13px', fontWeight: '500', color: '#94a3b8' }}>
            <a href="#features" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Features</a>
            <a href="#calculator" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>ROI Calculator</a>
            <a href="#pricing" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>Pricing</a>
            <a href="#faq" style={{ color: 'inherit', textDecoration: 'none', transition: 'color 0.2s' }}>FAQ</a>
          </nav>

          {/* NAVBAR CTA BUTTONS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onLaunchDemo && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '8px', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '5px' }}
                onClick={() => onLaunchDemo('landlord')}
              >
                <Sparkles size={13} /> Try Demo
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.12)', background: 'rgba(255, 255, 255, 0.04)', color: '#fff' }}
              onClick={onSignIn}
            >
              Sign In
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{
                fontSize: '12px',
                padding: '6px 16px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                color: '#fff',
                fontWeight: '600',
                border: 'none'
              }}
              onClick={onGetStarted}
            >
              Start Free Trial
            </button>
          </div>

        </div>
      </header>

      {/* MAIN CONTENT REGION */}
      <main id="main-content">

      {/* 2. HERO SECTION */}
      <section style={{ position: 'relative', padding: '70px 20px 60px 20px', overflow: 'hidden', textAlign: 'center' }}>
        
        {/* BACKGROUND GLOW ACCENTS */}
        <div style={{
          position: 'absolute',
          top: '-120px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '650px',
          height: '400px',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.2) 0%, rgba(11, 15, 25, 0) 70%)',
          pointerEvents: 'none',
          zIndex: 0
        }} />

        <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
          
          {/* BADGE */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: '20px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            fontSize: '12px',
            fontWeight: '600',
            color: '#a5b4fc',
            marginBottom: '20px'
          }}>
            <Sparkles size={14} style={{ color: '#818cf8' }} />
            The Next-Gen Property Management Platform for Africa
          </div>

          {/* MAIN HEADLINE */}
          <h1 style={{
            fontSize: 'clamp(32px, 6vw, 64px)',
            fontWeight: '900',
            lineHeight: 1.08,
            letterSpacing: '-0.04em',
            margin: '0 0 20px 0',
            color: '#ffffff'
          }}>
            Autonomous Property Intelligence <br />
            <span style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #38bdf8 50%, #10b981 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              for African Real Estate.
            </span>
          </h1>

          {/* SUBTITLE */}
          <p style={{
            fontSize: 'clamp(15px, 2.2vw, 18px)',
            color: '#94a3b8',
            lineHeight: 1.65,
            maxWidth: '720px',
            margin: '0 auto 34px auto'
          }}>
            Automated Safaricom M-Pesa billing, caretaker photo-verified meter logs, CCTV access control, and KRA tax compliance — orchestrated into a single autonomous ledger for institutional landlords.
          </p>

          {/* HERO ACTIONS */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '36px' }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 32px',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: '700',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 8px 28px rgba(99, 102, 241, 0.45)',
                transition: 'all 0.2s ease'
              }}
              onClick={onGetStarted}
            >
              Start Free 30-Day Trial <ArrowRight size={16} />
            </button>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 24px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: '600',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer'
              }}
              onClick={onSignIn}
            >
              Sign In
            </button>
            {onLaunchDemo && (
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '14px 24px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '600',
                  background: 'rgba(147, 51, 234, 0.15)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  cursor: 'pointer'
                }}
                onClick={() => onLaunchDemo('landlord')}
              >
                <Sparkles size={15} style={{ color: '#c084fc' }} /> Explore Sandbox Demo
              </button>
            )}
          </div>

          {/* TRUST TICKER */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px', fontSize: '12px', color: '#64748b', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Instant M-Pesa STK Matching</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Auto Utility Calculation</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Zero Card Required</span>
          </div>

        </div>

        {/* 3. CINEMATIC ARCHITECTURAL VIEWPORT WITH FLOATING TELEMETRY */}
        <div style={{ maxWidth: '1080px', margin: '48px auto 0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{
            position: 'relative',
            borderRadius: '24px',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 30px 80px -15px rgba(0, 0, 0, 0.9), 0 0 60px rgba(99, 102, 241, 0.2)'
          }}>
            {/* HERO ARCHITECTURAL IMAGE */}
            <img
              src="/assets/luxury_african_tower_hero.jpg"
              alt="Luxury African Residential Tower at Golden Hour"
              style={{
                width: '100%',
                height: 'auto',
                minHeight: '380px',
                maxHeight: '560px',
                objectFit: 'cover',
                display: 'block'
              }}
            />

            {/* DARK VIGNETTE & LIGHTING OVERLAYS */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(8, 12, 20, 0.4) 0%, rgba(8, 12, 20, 0.1) 40%, rgba(8, 12, 20, 0.85) 100%)',
              pointerEvents: 'none'
            }} />

            {/* FLOATING TELEMETRY BEACON 1: DARAJA LIVE FEED (TOP RIGHT) */}
            <div className="hero-telemetry-pill" style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              background: 'rgba(9, 13, 22, 0.85)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              borderRadius: '30px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(16, 185, 129, 0.25)',
              backdropFilter: 'blur(12px)'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 10px #10b981' }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '11px', fontWeight: '800', color: '#fff' }}>Safaricom Daraja Feed: +KES 35,000</div>
                <div style={{ fontSize: '9px', color: '#10b981' }}>Unit 4B · 0.28s auto-matched ✓</div>
              </div>
            </div>

            {/* FLOATING TELEMETRY BEACON 2: CARETAKER METER (MIDDLE LEFT) */}
            <div className="hero-telemetry-pill" style={{
              position: 'absolute',
              top: '50%',
              left: '24px',
              transform: 'translateY(-50%)',
              background: 'rgba(9, 13, 22, 0.85)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              borderRadius: '30px',
              padding: '8px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.25)',
              backdropFilter: 'blur(12px)'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block', boxShadow: '0 0 10px #38bdf8' }} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '11px', fontWeight: '800', color: '#fff' }}>Caretaker Meter Lens</div>
                <div style={{ fontSize: '9px', color: '#38bdf8' }}>17.7 m³ (Photo + GPS Tagged)</div>
              </div>
            </div>

            {/* BOTTOM ARCHITECTURAL OVERLAY BAR */}
            <div style={{
              position: 'absolute',
              bottom: '16px',
              left: '16px',
              right: '16px',
              background: 'rgba(9, 13, 22, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '16px',
              padding: '12px 20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              backdropFilter: 'blur(16px)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Building2 size={16} style={{ color: '#818cf8' }} />
                <span style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>Kilimani Heights Estate · Nairobi</span>
                <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 8px', borderRadius: '10px' }}>36/36 Units Connected</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: '#94a3b8' }}>
                <span>ANPR Gate: <strong style={{ color: '#fff' }}>Barrier Open (KDA 291M)</strong></span>
                <span style={{ color: '#10b981', fontWeight: '700' }}>● All 4 Telemetry Feeds Active</span>
              </div>
            </div>
          </div>
        </div>

      </section>

      {/* 4. STATS / PROOF TICKER */}
      <section style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', background: 'rgba(255, 255, 255, 0.02)', padding: '36px 20px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '24px', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#818cf8' }}>99.4%</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>On-Time Rent Collection</div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#38bdf8' }}>&lt; 30s</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>M-Pesa Reconciliation Speed</div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#10b981' }}>100%</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Audit & Tax Ready</div>
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#c084fc' }}>10,000+</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Units Managed Across Kenya</div>
          </div>
        </div>
      </section>

      {/* 4.5 UNIFIED INTEGRATION HUB */}
      <section style={{ padding: '80px 20px 40px 20px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* SECTION HEADER */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '30px',
            padding: '4px 16px',
            fontSize: '11px',
            fontWeight: '700',
            textTransform: 'uppercase',
            color: '#a5b4fc',
            letterSpacing: '0.08em',
            marginBottom: '14px'
          }}>
            <Sparkles size={13} style={{ color: '#818cf8' }} /> Unified Integration Hub
          </div>
          <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 42px)', fontWeight: '800', margin: '0 0 14px 0', color: '#fff', letterSpacing: '-0.02em' }}>
            The Autonomous Engine for African Real Estate
          </h2>
          <p style={{ fontSize: '15px', color: '#94a3b8', maxWidth: '680px', margin: '0 auto', lineHeight: 1.6 }}>
            Connecting mobile money, local banking, caretaker field operations, CCTV surveillance, and KRA tax compliance into a single real-time ledger.
          </p>
        </div>

        {/* INTERACTIVE INTEGRATION FLOW TREE */}
        <div style={{
          background: 'radial-gradient(ellipse at top, rgba(99, 102, 241, 0.12) 0%, rgba(15, 23, 42, 0.6) 70%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '24px',
          padding: '40px 24px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* DESKTOP / TABLET FLOW TREE */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', maxWidth: '960px', margin: '0 auto' }}>
            {/* INTEGRATION NODES ROW */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', width: '100%', marginBottom: '28px', zIndex: 2 }}>
              {/* NODE 1: SAFARICOM M-PESA */}
              <div className="integration-node" style={{ background: '#0b1120', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.15)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', flexShrink: 0 }}>
                  <Zap size={17} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: '12px', fontWeight: '700' }}>Safaricom M-Pesa</div>
                  <div style={{ color: '#10b981', fontSize: '10px', fontWeight: '600' }}>Daraja C2B / Till API</div>
                </div>
              </div>

              {/* NODE 2: LOCAL BANKS */}
              <div className="integration-node" style={{ background: '#0b1120', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 14px rgba(56, 189, 248, 0.15)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8', flexShrink: 0 }}>
                  <CreditCard size={17} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: '12px', fontWeight: '700' }}>Bank Feeds</div>
                  <div style={{ color: '#38bdf8', fontSize: '10px', fontWeight: '600' }}>Equity • KCB • Co-op</div>
                </div>
              </div>

              {/* NODE 3: CCTV SURVEILLANCE */}
              <div className="integration-node" style={{ background: '#0b1120', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 14px rgba(245, 158, 11, 0.15)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
                  <Camera size={17} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: '12px', fontWeight: '700' }}>CCTV Streams</div>
                  <div style={{ color: '#f59e0b', fontSize: '10px', fontWeight: '600' }}>RTSP / ONVIF IP Cams</div>
                </div>
              </div>

              {/* NODE 4: KRA ETIMS */}
              <div className="integration-node" style={{ background: '#0b1120', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 4px 14px rgba(239, 68, 68, 0.15)' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', flexShrink: 0 }}>
                  <ShieldCheck size={17} />
                </div>
                <div>
                  <div style={{ color: '#fff', fontSize: '12px', fontWeight: '700' }}>Tax Compliance</div>
                  <div style={{ color: '#ef4444', fontSize: '10px', fontWeight: '600' }}>KRA eTIMS Validated</div>
                </div>
              </div>
            </div>

            {/* ANIMATED SVG BEAM CONNECTORS */}
            <svg style={{ width: '100%', height: '40px', overflow: 'visible', margin: '-10px 0 10px 0' }}>
              <line x1="12%" y1="0" x2="50%" y2="35" stroke="rgba(16, 185, 129, 0.4)" strokeWidth="2" className="animated-beam" />
              <line x1="37%" y1="0" x2="50%" y2="35" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="2" className="animated-beam" />
              <line x1="63%" y1="0" x2="50%" y2="35" stroke="rgba(245, 158, 11, 0.4)" strokeWidth="2" className="animated-beam" />
              <line x1="88%" y1="0" x2="50%" y2="35" stroke="rgba(239, 68, 68, 0.4)" strokeWidth="2" className="animated-beam" />
            </svg>

            {/* CENTRAL HUB NODE */}
            <div className="hub-glow" style={{
              background: '#090d16',
              border: '2px solid rgba(99, 102, 241, 0.5)',
              borderRadius: '40px',
              padding: '10px 28px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              zIndex: 3
            }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #d946ef)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <Building2 size={16} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#fff', fontSize: '13px', fontWeight: '800', letterSpacing: '-0.01em' }}>Smart Landlord Autonomous Engine</div>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>Real-Time Ledger & Field Operations Hub</div>
              </div>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 10px #10b981' }} />
            </div>
          </div>
        </div>
      </section>

      {/* 5. ENTERPRISE TABBED FEATURE SHOWCASE */}
      <section id="features" style={{ padding: '60px 20px 100px 20px', maxWidth: '1140px', margin: '0 auto' }}>

        {/* SECTION HEADER */}
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', color: '#818cf8', letterSpacing: '0.1em', marginBottom: '12px' }}>
            Platform Capabilities
          </div>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: '800', margin: '0 0 16px 0', color: '#fff', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            Every tool you need.<br />Nothing you don't.
          </h2>
          <p style={{ fontSize: '16px', color: '#64748b', maxWidth: '560px', margin: '0 auto', lineHeight: 1.65 }}>
            Built for African landlords managing 1 to 10,000 units — with local payment rails, field operations, and institutional oversight baked in.
          </p>
        </div>

        {/* TABBED LAYOUT */}
        <div
          className="features-layout"
          style={{ alignItems: 'start' }}
          onMouseEnter={() => setFeaturesPaused(true)}
          onMouseLeave={() => setFeaturesPaused(false)}
        >

          {/* LEFT: TAB LIST */}
          <div className="features-tab-list">
            {features.map((f, i) => {
              const Icon = f.icon;
              const isActive = i === activeFeature;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setActiveFeature(i);
                    setFeaturesPaused(true);
                    setTimeout(() => setFeaturesPaused(false), 8000);
                  }}
                  className="features-tab-btn"
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: isActive ? `1px solid ${f.accentColor}30` : '1px solid transparent',
                    background: isActive ? f.accentBg : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    overflow: 'hidden'
                  }}
                >
                  <div style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    background: isActive ? `${f.accentColor}20` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isActive ? f.accentColor + '40' : 'rgba(255,255,255,0.06)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isActive ? f.accentColor : '#475569',
                    flexShrink: 0,
                    transition: 'all 0.2s ease'
                  }}>
                    <Icon size={16} />
                  </div>
                  <span className="tab-label" style={{
                    fontSize: '13px',
                    fontWeight: isActive ? '600' : '500',
                    color: isActive ? '#fff' : '#64748b',
                    transition: 'color 0.2s ease'
                  }}>
                    {f.label}
                  </span>
                  {isActive && (
                    <ArrowRight size={14} className="tab-arrow" style={{ color: f.accentColor, marginLeft: 'auto', flexShrink: 0 }} />
                  )}
                  {/* PROGRESS SWEEP BAR */}
                  {isActive && !featuresPaused && (
                    <span style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      height: '2px',
                      background: f.accentColor,
                      borderRadius: '0 0 0 10px',
                      animation: `featureSweep ${CYCLE_MS}ms linear forwards`,
                      opacity: 0.8
                    }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* RIGHT: PREVIEW PANEL */}
          {(() => {
            const f = features[activeFeature];
            return (
              <div key={activeFeature} className="features-panel features-panel-transition" style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.07)',
                borderRadius: '16px',
                overflow: 'hidden'
              }}>

                {/* PANEL HEADER BAR */}
                <div style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(255, 255, 255, 0.02)'
                }}>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block', opacity: 0.6 }} />
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b', display: 'inline-block', opacity: 0.6 }} />
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', display: 'inline-block', opacity: 0.6 }} />
                  </div>
                  <span style={{ fontSize: '11px', color: '#475569', marginLeft: '4px', fontFamily: 'monospace' }}>smart-landlord.app / {f.preview}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: '700', color: f.badgeColor, background: `${f.badgeColor}18`, border: `1px solid ${f.badgeColor}30`, padding: '2px 8px', borderRadius: '20px' }}>
                    {f.badge}
                  </span>
                </div>

                {/* PANEL CONTENT GRAPHIC */}
                <div className="features-panel-body" style={{ padding: '32px 28px' }}>

                  {/* M-PESA RECONCILIATION PREVIEW */}
                  {f.preview === 'mpesa' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live Ingestion Feed</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#10b981', marginTop: '2px' }}>KES 478,000</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Reconciled today · 0 exceptions</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '700', color: '#10b981' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 8px #10b981' }} />
                          Live
                        </div>
                      </div>
                      {[
                        { tenant: 'Jane Wambui', unit: 'Unit 4B', ref: 'QK8291KL0P', amount: 'KES 35,000', source: 'M-Pesa Paybill', color: '#10b981', abbr: 'M' },
                        { tenant: 'David Ochieng', unit: 'Unit 2A', ref: 'FT262309', amount: 'KES 28,000', source: 'Equity Bank Direct', color: '#38bdf8', abbr: 'B' },
                        { tenant: 'Sarah Njoki', unit: 'Unit 7C', ref: 'QK9012AB3C', amount: 'KES 45,000', source: 'M-Pesa Till', color: '#10b981', abbr: 'M' }
                      ].map((tx, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: `${tx.color}20`, border: `1px solid ${tx.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: tx.color }}>
                              {tx.abbr}
                            </div>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{tx.tenant} <span style={{ color: '#475569', fontWeight: '400' }}>· {tx.unit}</span></div>
                              <div style={{ fontSize: '10px', color: '#475569', fontFamily: 'monospace', marginTop: '1px' }}>Ref: {tx.ref} · {tx.source}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#10b981' }}>{tx.amount}</div>
                            <div style={{ fontSize: '9px', color: '#10b981', fontWeight: '600', marginTop: '2px' }}>Auto-matched ✓</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* CARETAKER PREVIEW */}
                  {f.preview === 'caretaker' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Field Entry — Kilimani Heights</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#38bdf8', marginTop: '2px' }}>24 / 36 Logged</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Caretaker: J. Mwangi · Today 09:14 AM</div>
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: '600', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', padding: '4px 10px', borderRadius: '20px', color: '#38bdf8' }}>
                          GPS Verified
                        </div>
                      </div>
                      {[
                        { unit: 'Unit B-04', prev: '340.5', curr: '358.2', usage: '17.7 m³', bill: 'KES 2,655', verified: true },
                        { unit: 'Unit B-05', prev: '221.0', curr: '234.3', usage: '13.3 m³', bill: 'KES 1,995', verified: true },
                        { unit: 'Unit B-06', prev: '189.2', curr: '201.8', usage: '12.6 m³', bill: 'KES 1,890', verified: false }
                      ].map((r, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '12px', alignItems: 'center', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: '#e2e8f0' }}>{r.unit}</div>
                            <div style={{ fontSize: '10px', color: '#475569' }}>Water</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10px', color: '#475569' }}>Previous</div>
                            <div style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>{r.prev} m³</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10px', color: '#475569' }}>Current</div>
                            <div style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'monospace', fontWeight: '700' }}>{r.curr} m³</div>
                          </div>
                          <div>
                            <div style={{ fontSize: '10px', color: '#475569' }}>Charge</div>
                            <div style={{ fontSize: '12px', color: '#10b981', fontWeight: '700' }}>{r.bill}</div>
                          </div>
                          <div style={{ fontSize: '10px', color: r.verified ? '#10b981' : '#f59e0b', fontWeight: '700' }}>
                            {r.verified ? '✓' : '⏳'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* INVOICING PREVIEW */}
                  {f.preview === 'invoicing' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>August 2026 Rent Roll</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#818cf8', marginTop: '2px' }}>36 Invoices</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Dispatched via SMS · Total KES 1,622,400</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '700' }}>100% Sent ✓</div>
                          <div style={{ fontSize: '10px', color: '#475569', marginTop: '2px' }}>Includes STK Push link</div>
                        </div>
                      </div>
                      {[
                        { unit: 'Unit 101', tenant: 'Peter Kamau', rent: 25000, water: 3200, garbage: 500, total: 28700 },
                        { unit: 'Unit 102', tenant: 'Sarah Muthoni', rent: 38000, water: 2100, garbage: 500, total: 40600 },
                        { unit: 'Unit 103', tenant: 'Brian Omondi', rent: 42000, water: 4100, garbage: 500, total: 46600 }
                      ].map((inv, i) => (
                        <div key={i} style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{inv.unit} · {inv.tenant}</div>
                            <div style={{ fontSize: '14px', fontWeight: '800', color: '#818cf8' }}>KES {inv.total.toLocaleString()}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#475569' }}>
                            <span>Rent <span style={{ color: '#94a3b8' }}>KES {inv.rent.toLocaleString()}</span></span>
                            <span>Water <span style={{ color: '#94a3b8' }}>KES {inv.water.toLocaleString()}</span></span>
                            <span>Garbage <span style={{ color: '#94a3b8' }}>KES {inv.garbage}</span></span>
                            <span style={{ marginLeft: 'auto', color: '#10b981', fontWeight: '600' }}>SMS ✓</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* CCTV PREVIEW */}
                  {f.preview === 'cctv' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Security Feeds — Live</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#f59e0b', marginTop: '2px' }}>3 Cameras</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>Kilimani Heights · All streams healthy</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '700', color: '#ef4444' }}>
                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                          REC
                        </div>
                      </div>
                      {[
                        { name: 'Main Gate 01', zone: 'Vehicle Barrier & ANPR', res: '1080p', status: 'ANPR Active', statusColor: '#f59e0b' },
                        { name: 'Parking Bay A', zone: '28 / 30 Slots Occupied', res: '1080p', status: 'Recording', statusColor: '#10b981' },
                        { name: 'Ground Lobby', zone: 'Access PIN Door · 3 entries/hr', res: '1080p', status: 'Recording', statusColor: '#10b981' }
                      ].map((cam, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '14px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                          <div style={{ width: '64px', height: '44px', borderRadius: '6px', background: '#000', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Camera size={18} style={{ color: '#f59e0b', opacity: 0.7 }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{cam.name}</div>
                            <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{cam.zone} · {cam.res}</div>
                          </div>
                          <div style={{ fontSize: '10px', fontWeight: '700', color: cam.statusColor, background: `${cam.statusColor}15`, border: `1px solid ${cam.statusColor}30`, padding: '2px 8px', borderRadius: '20px', flexShrink: 0 }}>
                            {cam.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* PORTFOLIO PREVIEW */}
                  {f.preview === 'portfolio' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#475569', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portfolio Overview</div>
                          <div style={{ fontSize: '22px', fontWeight: '800', color: '#c084fc', marginTop: '2px' }}>KES 4,772,000</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>August net collected · 2 estates · 84 units</div>
                        </div>
                        <div style={{ fontSize: '10px', fontWeight: '700', color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '3px 10px', borderRadius: '20px' }}>
                          ✓ KRA eTIMS Validated
                        </div>
                      </div>
                      {[
                        { name: 'Kilimani Heights', units: 36, occupied: 36, collected: 'KES 1,622,400', rate: 100, caretaker: 'J. Mwangi', color: '#10b981' },
                        { name: 'Westlands Square', units: 48, occupied: 46, collected: 'KES 3,149,600', rate: 96, caretaker: 'E. Kimani', color: '#38bdf8' }
                      ].map((estate, i) => (
                        <div key={i} style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: '600', color: '#e2e8f0' }}>{estate.name}</div>
                              <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>Caretaker: {estate.caretaker} · {estate.occupied}/{estate.units} occupied</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '13px', fontWeight: '700', color: '#c084fc' }}>{estate.collected}</div>
                              <div style={{ fontSize: '11px', color: estate.color, fontWeight: '600' }}>{estate.rate}% collected</div>
                            </div>
                          </div>
                          <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${estate.rate}%`, height: '100%', background: estate.color, borderRadius: '2px', transition: 'width 0.6s ease' }} />
                          </div>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: '8px', paddingTop: '4px' }}>
                        {['PDF Report', 'Excel Ledger', 'KRA eTIMS Export'].map((btn, i) => (
                          <div key={i} style={{ padding: '6px 14px', fontSize: '11px', fontWeight: '600', borderRadius: '6px', background: i === 2 ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)', color: i === 2 ? '#10b981' : '#64748b', border: `1px solid ${i === 2 ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)'}`, cursor: 'pointer' }}>
                            {btn}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>

                {/* PANEL FOOTER */}
                <div className="features-panel-footer" style={{
                  padding: '16px 28px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  background: 'rgba(255, 255, 255, 0.01)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: '#fff' }}>{features[activeFeature].headline}</div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px', maxWidth: '480px', lineHeight: 1.5 }}>{features[activeFeature].body}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600', color: features[activeFeature].accentColor, flexShrink: 0, marginLeft: '24px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Learn more <ArrowRight size={13} />
                  </div>
                </div>

              </div>
            );
          })()}

        </div>

      </section>




      {/* 5.5 LIVE ESTATE TELEMETRY INSPECTOR */}
      <section style={{ padding: '80px 20px', maxWidth: '1140px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '30px',
            padding: '4px 16px',
            fontSize: '11px',
            fontWeight: '700',
            textTransform: 'uppercase',
            color: '#38bdf8',
            letterSpacing: '0.08em',
            marginBottom: '12px'
          }}>
            <Activity size={13} style={{ color: '#38bdf8' }} /> Live Field Telemetry
          </div>
          <h2 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: '800', margin: '0 0 12px 0', color: '#fff', letterSpacing: '-0.02em' }}>
            Interactive Estate & Unit Inspector
          </h2>
          <p style={{ fontSize: '15px', color: '#94a3b8', maxWidth: '620px', margin: '0 auto', lineHeight: 1.6 }}>
            Touch any unit below to inspect live Daraja C2B reconciliations, verified meter photos, and real-time gate telemetry.
          </p>
        </div>

        {/* ESTATE SELECTOR PILLS */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
          {estateData.map((estate, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setSelectedEstate(idx);
                setSelectedUnitIdx(0);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                borderRadius: '30px',
                fontSize: '13px',
                fontWeight: '600',
                background: selectedEstate === idx ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border: `1px solid ${selectedEstate === idx ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.08)'}`,
                color: selectedEstate === idx ? '#fff' : '#94a3b8',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              <Building2 size={15} style={{ color: selectedEstate === idx ? '#818cf8' : '#64748b' }} />
              {estate.name}
              <span style={{ fontSize: '11px', color: '#64748b' }}>({estate.totalUnits} Units)</span>
            </button>
          ))}
        </div>

        {/* UNIT SELECTOR PILLS */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
          {estateData[selectedEstate].units.map((unit, uIdx) => (
            <button
              key={uIdx}
              type="button"
              onClick={() => setSelectedUnitIdx(uIdx)}
              style={{
                padding: '7px 16px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: selectedUnitIdx === uIdx ? '700' : '500',
                background: selectedUnitIdx === uIdx ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                border: `1px solid ${selectedUnitIdx === uIdx ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.06)'}`,
                color: selectedUnitIdx === uIdx ? '#10b981' : '#cbd5e1',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {unit.code} · {unit.tenant}
            </button>
          ))}
        </div>

        {/* TELEMETRY CARD */}
        {(() => {
          const currentUnit = estateData[selectedEstate].units[selectedUnitIdx];
          const estate = estateData[selectedEstate];
          return (
            <div style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 20px 50px -10px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.1)',
              backdropFilter: 'blur(16px)'
            }}>
              {/* TOP SUMMARY ROW */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '16px', marginBottom: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: 0 }}>
                      {currentUnit.code} · {currentUnit.tenant}
                    </h3>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '2px 8px', borderRadius: '12px' }}>
                      {currentUnit.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={13} style={{ color: '#818cf8' }} /> {estate.location} · Caretaker: {estate.caretaker}
                  </div>
                </div>

                {/* SIMULATE STK PUSH BUTTON */}
                <div>
                  <button
                    type="button"
                    onClick={handleSimulateStk}
                    disabled={simulatedStkState === 'pushing'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 18px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: '700',
                      background: simulatedStkState === 'paid' ? 'rgba(16, 185, 129, 0.25)' : 'linear-gradient(135deg, #10b981, #059669)',
                      border: simulatedStkState === 'paid' ? '1px solid #10b981' : 'none',
                      color: '#fff',
                      cursor: simulatedStkState === 'pushing' ? 'wait' : 'pointer',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                      transition: 'all 0.25s ease'
                    }}
                  >
                    <Zap size={14} />
                    {simulatedStkState === 'pushing' && 'Triggering Daraja STK Push...'}
                    {simulatedStkState === 'paid' && '✓ Payment Matched in 0.28s!'}
                    {simulatedStkState === 'idle' && 'Test Live M-Pesa STK Push'}
                  </button>
                </div>
              </div>

              {/* 3-COLUMN TELEMETRY GRID */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                {/* METRIC 1: M-PESA RECONCILIATION */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#10b981', letterSpacing: '0.05em' }}>M-Pesa Ledger</span>
                    <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Daraja C2B</span>
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: '800', color: '#fff', marginBottom: '4px' }}>
                    KES {currentUnit.rent.toLocaleString()}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                    Ref: <code style={{ color: '#38bdf8' }}>{simulatedStkState === 'paid' ? 'QK9844NX12' : currentUnit.lastMpesaRef}</code>
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '6px' }}>
                    Auto-match latency: <strong style={{ color: '#10b981' }}>{currentUnit.matchTime}</strong>
                  </div>
                </div>

                {/* METRIC 2: WATER & POWER METERS */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#38bdf8', letterSpacing: '0.05em' }}>Caretaker Meter Log</span>
                    <span style={{ fontSize: '10px', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Photo Verified</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>Water Consumption</span>
                    <strong style={{ color: '#38bdf8' }}>{currentUnit.waterUsage} (KES {currentUnit.waterBill})</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>Power Consumption</span>
                    <strong style={{ color: '#f59e0b' }}>{currentUnit.powerUsage} (KES {currentUnit.powerBill})</strong>
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '8px' }}>
                    GPS Tag: <code style={{ color: '#94a3b8' }}>{currentUnit.gpsCoords}</code>
                  </div>
                </div>

                {/* METRIC 3: GATE & VEHICLE ACCESS */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '14px', padding: '18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#f59e0b', letterSpacing: '0.05em' }}>Gate Access & ANPR</span>
                    <span style={{ fontSize: '10px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>Barrier OK</span>
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#fff', marginBottom: '6px' }}>
                    {currentUnit.barrierAccess}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.4 }}>
                    Camera: <span style={{ color: '#cbd5e1' }}>Gate 01 HD Stream</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#10b981', marginTop: '6px', fontWeight: '600' }}>
                    ✓ Automatic KRA eTIMS invoice synced
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* 6. INTERACTIVE ROI CALCULATOR */}
      <section id="calculator" style={{ padding: '80px 20px', background: 'rgba(15, 23, 42, 0.6)', borderTop: '1px solid rgba(255, 255, 255, 0.06)', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#818cf8', letterSpacing: '0.08em' }}>Interactive ROI Calculator</span>
            <h2 style={{ fontSize: 'clamp(24px, 4vw, 34px)', fontWeight: '800', margin: '8px 0', color: '#fff' }}>See How Much You Save Every Month</h2>
            <p style={{ fontSize: '13px', color: '#94a3b8' }}>Adjust the sliders below to calculate your estimated time savings and recovered revenue.</p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px',
            background: 'rgba(30, 41, 59, 0.7)',
            padding: '30px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            
            {/* CONTROLS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600' }}>Number of Units:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      value={unitCount}
                      onChange={e => setUnitCount(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
                      style={{
                        width: '90px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#818cf8',
                        fontSize: '14px',
                        fontWeight: '800',
                        textAlign: 'right'
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600' }}>units</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10000"
                  step="1"
                  value={unitCount}
                  onChange={e => setUnitCount(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                  <span>1 unit</span>
                  <span>2,500</span>
                  <span>5,000</span>
                  <span>10,000 units</span>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600' }}>Average Monthly Rent per Unit:</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>KES</span>
                    <input
                      type="number"
                      min="1000"
                      max="2500000"
                      step="1000"
                      value={avgRent}
                      onChange={e => setAvgRent(Math.max(1000, Math.min(2500000, Number(e.target.value) || 1000)))}
                      style={{
                        width: '120px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        color: '#818cf8',
                        fontSize: '14px',
                        fontWeight: '800',
                        textAlign: 'right'
                      }}
                    />
                  </div>
                </div>
                <input
                  type="range"
                  min="2000"
                  max="2000000"
                  step="2000"
                  value={avgRent}
                  onChange={e => setAvgRent(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                  <span>KES 2,000</span>
                  <span>KES 500k</span>
                  <span>KES 1.5M+</span>
                  <span>KES 2M</span>
                </div>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '12px', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lightbulb size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <em>Scales from single residential flats up to 10,000+ unit multi-estate and commercial portfolios.</em>
              </div>
            </div>

            {/* RESULTS */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(16, 185, 129, 0.15) 100%)',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: '18px'
            }}>
              <div>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Estimated Admin Time Saved</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={24} style={{ color: '#818cf8' }} /> {hoursSavedPerMonth.toLocaleString()} hours / mo
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>
                  Software Cost ({unitRate < 75 ? `${unitRate === 50 ? '33%' : '13%'} Volume Discount applied` : 'Standard Rate'})
                </div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Receipt size={22} style={{ color: '#38bdf8' }} /> KES {totalMonthlySoftwareCost.toLocaleString()}
                  <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '500' }}>
                    (@ KES {unitRate} / unit)
                  </span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase' }}>Recovered Uncollected Revenue</div>
                <div style={{ fontSize: '26px', fontWeight: '800', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <TrendingUp size={22} style={{ color: '#10b981' }} /> KES {estimatedCollectionBoost.toLocaleString()} / mo
                </div>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '700',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  marginTop: '4px'
                }}
                onClick={onGetStarted}
              >
                Claim Your Savings — Start 30-Day Free Trial
              </button>
            </div>

          </div>

        </div>
      </section>

      {/* 7. TRANSPARENT PRICING PLANS */}
      <section id="pricing" style={{ padding: '80px 20px', maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
        <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#818cf8', letterSpacing: '0.08em' }}>
          Simple, Scalable Pricing
        </span>
        <h2 style={{ fontSize: 'clamp(26px, 4.5vw, 42px)', fontWeight: '800', margin: '10px 0 12px 0', color: '#fff', letterSpacing: '-0.02em' }}>
          Pick the Plan that Fits Your Portfolio
        </h2>
        <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '580px', margin: '0 auto 40px auto', lineHeight: 1.6 }}>
          All plans include a {pricingConfig.trial_days || 30}-day free trial (1 full billing cycle). Cancel anytime with zero lock-in contracts.
        </p>

        {/* PRICING GRID */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '24px', textAlign: 'left', alignItems: 'stretch' }}>
          
          {/* 1. STARTER CARD */}
          <div style={{
            background: 'rgba(19, 27, 46, 0.75)',
            padding: '32px 28px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 6px 0', color: '#fff' }}>Starter</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 20px 0', minHeight: '34px', lineHeight: 1.5 }}>
              For independent landlords managing small estates.
            </p>
            <div style={{ fontSize: '34px', fontWeight: '800', color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              KES {Number(pricingConfig.starter_package_price || 1500).toLocaleString()} <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: '500' }}>/ month</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', color: '#cbd5e1' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Up to {pricingConfig.starter_max_units || 20} Occupied Units</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Automated Rent Invoicing</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> M-Pesa Transaction Matching</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> 1 Caretaker Login</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Vacant Units Cost KES 0</li>
            </ul>
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                marginTop: 'auto',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                cursor: 'pointer'
              }}
              onClick={onGetStarted}
            >
              Get Started
            </button>
          </div>

          {/* 2. PROFESSIONAL CARD (FEATURED - MOST POPULAR) */}
          <div style={{
            background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.18) 0%, rgba(19, 27, 46, 0.9) 100%)',
            padding: '32px 28px',
            borderRadius: '16px',
            border: '2px solid #6366f1',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            boxShadow: '0 15px 40px rgba(99, 102, 241, 0.25)'
          }}>
            <div style={{
              position: 'absolute',
              top: '-13px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: '800',
              padding: '3px 14px',
              borderRadius: '20px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)'
            }}>
              Most Popular
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 6px 0', color: '#fff' }}>Professional</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 20px 0', minHeight: '34px', lineHeight: 1.5 }}>
              For growing property owners and residential complexes.
            </p>
            <div style={{ fontSize: '34px', fontWeight: '800', color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              KES {Number(pricingConfig.growth_package_price || 4500).toLocaleString()} <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: '500' }}>/ month</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', color: '#cbd5e1' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Up to {pricingConfig.growth_max_units || 70} Occupied Units</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Automated SMS & Email Reminders</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Unlimited Caretakers & Meter Readings</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Bank Statement Auto-Reconcile</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> CCTV Feeds Integration</li>
            </ul>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                marginTop: 'auto',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '700',
                width: '100%',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                boxShadow: '0 6px 20px rgba(99, 102, 241, 0.4)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer'
              }}
              onClick={onGetStarted}
            >
              Start {pricingConfig.trial_days || 30}-Day Free Trial
            </button>
          </div>

          {/* 3. PORTFOLIO CARD */}
          <div style={{
            background: 'rgba(19, 27, 46, 0.75)',
            padding: '32px 28px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 6px 0', color: '#fff' }}>Portfolio</h3>
            <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 20px 0', minHeight: '34px', lineHeight: 1.5 }}>
              For property management agencies & large portfolios.
            </p>
            <div style={{ fontSize: '34px', fontWeight: '800', color: '#fff', marginBottom: '24px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              KES {Number(pricingConfig.portfolio_package_price || 7500).toLocaleString()} <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: '500' }}>/ month</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', color: '#cbd5e1' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> {pricingConfig.growth_max_units ? (Number(pricingConfig.growth_max_units) + 1) + '+' : '71+'} Occupied Units</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Custom Paybill / Till API Integration</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Multi-Property Portfolio Organization</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Multi-User Role Permissions</li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><Check size={16} style={{ color: '#10b981', flexShrink: 0 }} /> Dedicated Account Manager & SLA</li>
            </ul>
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                marginTop: 'auto',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#fff',
                cursor: 'pointer'
              }}
              onClick={onGetStarted}
            >
              Contact Sales
            </button>
          </div>

        </div>
      </section>

      {/* 8. FAQ ACCORDION */}
      <section id="faq" style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#818cf8', letterSpacing: '0.08em' }}>Questions & Answers</span>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: '800', margin: '8px 0', color: '#fff' }}>Frequently Asked Questions</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {faqs.map((faq, idx) => {
            const isOpen = openFaqIndex === idx;
            return (
              <div
                key={idx}
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  overflow: 'hidden',
                  transition: 'all 0.2s'
                }}
              >
                <button
                  type="button"
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    background: 'none',
                    border: 'none',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: '600',
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                  onClick={() => setOpenFaqIndex(isOpen ? -1 : idx)}
                >
                  <span>{faq.q}</span>
                  {isOpen ? <ChevronUp size={18} style={{ color: '#818cf8' }} /> : <ChevronDown size={18} style={{ color: '#64748b' }} />}
                </button>
                {isOpen && (
                  <div style={{ padding: '0 20px 18px 20px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '12px' }}>
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 9. FINAL CALL TO ACTION BANNER */}
      <section style={{ padding: '80px 20px', textAlign: 'center', position: 'relative' }}>
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(79, 70, 229, 0.4) 100%)',
          padding: '50px 30px',
          borderRadius: '20px',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)'
        }}>
          <h2 style={{ fontSize: 'clamp(24px, 4vw, 36px)', fontWeight: '800', margin: '0 0 12px 0', color: '#fff' }}>
            Ready to Automate Your Property Business?
          </h2>
          <p style={{ fontSize: '14px', color: '#cbd5e1', maxWidth: '550px', margin: '0 auto 28px auto', lineHeight: 1.6 }}>
            Experience 1 full billing cycle completely free. Start your 30-day free trial today (no credit card required).
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 28px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '700',
                background: '#fff',
                color: '#4f46e5',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)'
              }}
              onClick={onGetStarted}
            >
              Get Started Now <ArrowRight size={16} />
            </button>
            <button
              type="button"
              style={{
                padding: '12px 22px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '600',
                background: 'rgba(0, 0, 0, 0.3)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                cursor: 'pointer'
              }}
              onClick={onSignIn}
            >
              Landlord Login
            </button>
          </div>
        </div>
      </section>
      </main>

      {/* 10. FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', background: '#070a11', padding: '50px 20px 30px 20px', fontSize: '12px', color: '#64748b' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '30px', marginBottom: '40px' }}>
          
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <img src="/icons/maskable-192.png" alt="Smart Landlord" style={{ width: '28px', height: '28px', borderRadius: '8px' }} />
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#fff' }}>Smart Landlord</span>
            </div>
            <p style={{ lineHeight: 1.6, margin: 0 }}>
              The all-in-one property management, utility billing, and automated rent collection platform.
            </p>
          </div>

          <div>
            <div style={{ fontWeight: '700', color: '#fff', marginBottom: '12px' }}>Product</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <a href="#features" style={{ color: 'inherit', textDecoration: 'none' }}>Features</a>
              <a href="#calculator" style={{ color: 'inherit', textDecoration: 'none' }}>ROI Calculator</a>
              <a href="#pricing" style={{ color: 'inherit', textDecoration: 'none' }}>Pricing Plans</a>
              <a href="#faq" style={{ color: 'inherit', textDecoration: 'none' }}>FAQ</a>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: '700', color: '#fff', marginBottom: '12px' }}>Portals</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button type="button" onClick={onSignIn} style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 'inherit' }}>
                Landlord Portal
              </button>
              <button type="button" onClick={onSignIn} style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 'inherit' }}>
                Caretaker Portal
              </button>
              <button type="button" onClick={onGetStarted} style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: 'inherit' }}>
                Create Account
              </button>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: '700', color: '#fff', marginBottom: '12px' }}>Security & Support</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={14} style={{ color: '#10b981' }} /> 256-bit SSL Data Encryption
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={14} style={{ color: '#38bdf8' }} /> Kenya Data Protection Act Compliant
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Mail size={14} style={{ color: '#818cf8' }} /> support@smartlandlord.co.ke
              </span>
            </div>
          </div>

        </div>

        <div style={{ maxWidth: '1200px', margin: '0 auto', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>© {new Date().getFullYear()} Smart Landlord. All rights reserved.</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span>Privacy Policy</span>
            <span>Terms of Service</span>
            <span>Security</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

