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
  Play
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

  // FAQ Accordion State
  const [openFaqIndex, setOpenFaqIndex] = useState(0);

  // CCTV Feed Switcher State
  const [activeCctvFeed, setActiveCctvFeed] = useState('gate');
  const cctvFeeds = {
    gate: { name: 'Main Gate 01', target: 'Vehicle Barrier & ANPR', res: '1080p @ 25 FPS' },
    parking: { name: 'Parking Bay A', target: '28/30 Slots Occupied', res: '1080p @ 25 FPS' },
    lobby: { name: 'Ground Lobby', target: 'Access PIN Entry Door', res: '1080p @ 30 FPS' }
  };

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
            fontSize: 'clamp(28px, 5vw, 54px)',
            fontWeight: '800',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            margin: '0 0 18px 0',
            color: '#ffffff'
          }}>
            Automate Rent Collection, Invoicing & <br />
            <span style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #38bdf8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Property Oversight with Ease
            </span>
          </h1>

          {/* SUBTITLE */}
          <p style={{
            fontSize: 'clamp(14px, 2vw, 17px)',
            color: '#94a3b8',
            lineHeight: 1.6,
            maxWidth: '680px',
            margin: '0 auto 30px auto'
          }}>
            Say goodbye to messy spreadsheets and uncollected rent. Smart Landlord combines automated M-Pesa billing, caretaker meter readings, CCTV feeds, and bank reconciliation in one unified dashboard.
          </p>

          {/* HERO ACTIONS */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '40px' }}>
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
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)'
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
                padding: '12px 22px',
                borderRadius: '10px',
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
                  padding: '12px 22px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  background: 'rgba(147, 51, 234, 0.14)',
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
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', fontSize: '12px', color: '#64748b', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Instant M-Pesa STK Matching</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Auto Utility Calculation</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle2 size={14} style={{ color: '#10b981' }} /> Zero Card Required</span>
          </div>

        </div>

        {/* 3. HERO DASHBOARD PREVIEW MOCKUP */}
        <div style={{ maxWidth: '1000px', margin: '50px auto 0 auto', position: 'relative', zIndex: 1 }}>
          <div style={{
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '16px',
            padding: '16px',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(99, 102, 241, 0.15)',
            textAlign: 'left'
          }}>
            
            {/* MOCKUP WINDOW HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#f59e0b' }} />
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
              </div>
              <div style={{ fontSize: '11px', color: '#64748b', background: 'rgba(0, 0, 0, 0.3)', padding: '3px 12px', borderRadius: '12px' }}>
                smartlandlord.app/dashboard
              </div>
              <div style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} /> Live System
              </div>
            </div>

            {/* MOCKUP CONTENT GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Collected Rent (Aug 2026)</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#10b981', marginTop: '4px' }}>KES 1,480,000</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>96.8% Collection Rate</div>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Occupied Units</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#fff', marginTop: '4px' }}>48 / 50 <span style={{ fontSize: '12px', color: '#818cf8', fontWeight: '600' }}>(96%)</span></div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>Across 3 Properties</div>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live Reconciliation</span>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#38bdf8', marginTop: '4px' }}>100% Matched</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>0 Unallocated Bank Lines</div>
              </div>

            </div>

            {/* MOCKUP RECENT ACTIVITY ROW */}
            <div style={{ background: 'rgba(0, 0, 0, 0.25)', borderRadius: '10px', padding: '12px', border: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: '#94a3b8', fontWeight: '600' }}>
                <span>Recent Live M-Pesa Transactions</span>
                <span style={{ color: '#818cf8' }}>Auto-credited</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '6px 10px', borderRadius: '6px' }}>
                  <div><strong>Tenant #1042</strong> (Block A • Unit 4B) • <span style={{ color: '#64748b' }}>REF: MPESA-***2KL9</span></div>
                  <div style={{ color: '#10b981', fontWeight: '700' }}>+ KES 35,000</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', padding: '6px 10px', borderRadius: '6px' }}>
                  <div><strong>Tenant #2118</strong> (Block B • Unit 12) • <span style={{ color: '#64748b' }}>REF: MPESA-***1X2</span></div>
                  <div style={{ color: '#10b981', fontWeight: '700' }}>+ KES 42,000</div>
                </div>
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

      {/* 5. MAGIC UI ASYMMETRIC BENTO GRID */}
      <section id="features" style={{ padding: '100px 20px', maxWidth: '1240px', margin: '0 auto' }}>
        
        {/* SECTION HEADER */}
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(99, 102, 241, 0.12)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '30px',
            padding: '5px 18px',
            fontSize: '11px',
            fontWeight: '700',
            textTransform: 'uppercase',
            color: '#a5b4fc',
            letterSpacing: '0.08em',
            marginBottom: '16px'
          }}>
            <Sparkles size={13} style={{ color: '#818cf8' }} /> Next-Generation Platform
          </div>
          <h2 style={{ fontSize: 'clamp(28px, 4.5vw, 44px)', fontWeight: '800', margin: '0 0 14px 0', color: '#fff', letterSpacing: '-0.025em' }}>
            Built for Elite Property Operators
          </h2>
          <p style={{ fontSize: '15px', color: '#94a3b8', maxWidth: '680px', margin: '0 auto', lineHeight: 1.6 }}>
            Every component is engineered with real-time African financial rails, automated field telemetry, and institutional-grade oversight.
          </p>
        </div>

        {/* 5-CARD MAGIC BENTO GRID */}
        <div className="magic-bento-grid">
          
          {/* CARD 1: INSTANT M-PESA & BANK RECONCILIATION (SPAN 2) */}
          <div className="magic-bento-card magic-span-2">
            
            {/* RICH TOP GRAPHICAL PREVIEW */}
            <div className="magic-bg-graphic" style={{ height: '220px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'radial-gradient(ellipse at top left, rgba(16, 185, 129, 0.12), rgba(9, 13, 22, 0.95))' }}>
              
              {/* TOP TICKER HEADER */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 10px #10b981' }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#fff', letterSpacing: '0.02em' }}>LIVE DARAJA C2B & BANK INGESTION</span>
                </div>
                <span style={{ fontSize: '10px', fontWeight: '700', color: '#10b981', background: 'rgba(16, 185, 129, 0.15)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  0.3s Match Speed
                </span>
              </div>

              {/* FLOATING TRANSACTIONS STREAM */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '6px 0' }}>
                
                <div className="float-tx-anim" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#10b981', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800' }}>M</div>
                    <div>
                      <div style={{ color: '#fff', fontSize: '11px', fontWeight: '700' }}>Jane Wambui • Unit 4B</div>
                      <div style={{ color: '#64748b', fontSize: '9px', fontFamily: 'monospace' }}>Ref: QK8291KL0P • Paybill 882910</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#10b981', fontSize: '12px', fontWeight: '800' }}>+KES 35,000</div>
                    <span style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px' }}>Auto-Matched</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#0284c7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800' }}>B</div>
                    <div>
                      <div style={{ color: '#fff', fontSize: '11px', fontWeight: '700' }}>David Ochieng • Unit 2A</div>
                      <div style={{ color: '#64748b', fontSize: '9px', fontFamily: 'monospace' }}>Ref: FT262309 • Equity Direct</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#38bdf8', fontSize: '12px', fontWeight: '800' }}>+KES 28,000</div>
                    <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: '9px', fontWeight: '700', padding: '1px 5px', borderRadius: '4px' }}>Auto-Matched</span>
                  </div>
                </div>

              </div>

              {/* BOTTOM METRIC */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#94a3b8', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '6px' }}>
                <span>Reconciled Today: <strong style={{ color: '#fff' }}>KES 478,000</strong></span>
                <span style={{ color: '#10b981', fontWeight: '700' }}>✓ Zero Manual Statements</span>
              </div>
            </div>

            {/* BOTTOM CARD CONTENT */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', marginBottom: '14px' }}>
                <Zap size={22} />
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: '700', color: '#fff', margin: '0 0 6px 0' }}>Instant M-Pesa & Bank Reconciliation</h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                Connect Safaricom Paybill, Till, or Bank feeds. Payments match instantly to tenant units, issue automated receipts, and update arrears in real time.
              </p>
              <div className="magic-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', color: '#818cf8', cursor: 'pointer' }}>
                <span>Explore Daraja webhooks</span>
                <ArrowRight size={14} />
              </div>
            </div>

          </div>

          {/* CARD 2: CARETAKER FIELD PORTAL & CAMERA (SPAN 1) */}
          <div className="magic-bento-card magic-span-1">
            
            {/* RICH TOP GRAPHICAL PREVIEW */}
            <div className="magic-bg-graphic" style={{ height: '220px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'radial-gradient(ellipse at top right, rgba(56, 189, 248, 0.15), rgba(9, 13, 22, 0.95))' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: '700', background: 'rgba(56, 189, 248, 0.12)', padding: '2px 8px', borderRadius: '10px' }}>CAMERA OCR</span>
                <span style={{ fontSize: '9px', color: '#64748b', fontFamily: 'monospace' }}>GPS: -1.2921, 36.8219</span>
              </div>

              {/* CAMERA VIEWFINDER FRAME */}
              <div style={{ position: 'relative', border: '1px dashed rgba(56, 189, 248, 0.4)', borderRadius: '8px', padding: '10px', background: 'rgba(0, 0, 0, 0.5)', overflow: 'hidden' }}>
                <div className="scan-line-anim" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '9px', color: '#94a3b8' }}>Unit B-04 Water Dial</span>
                  <span style={{ fontSize: '9px', color: '#10b981', fontWeight: '700' }}>99.4% Validated</span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'monospace', color: '#38bdf8', letterSpacing: '0.1em', textAlign: 'center', margin: '4px 0' }}>
                  0 3 5 8 . 2 <span style={{ fontSize: '11px', color: '#94a3b8' }}>m³</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#cbd5e1', background: 'rgba(255, 255, 255, 0.05)', padding: '4px 6px', borderRadius: '4px' }}>
                  <span>Prev: 340.5 m³</span>
                  <span style={{ color: '#10b981', fontWeight: '700' }}>+17.7 m³ (+KES 2,655)</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '9px', color: '#94a3b8' }}>
                <Camera size={11} style={{ color: '#38bdf8' }} />
                <span>Photo & GPS locked to tenant invoice</span>
              </div>
            </div>

            {/* BOTTOM CARD CONTENT */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8', marginBottom: '14px' }}>
                <Smartphone size={22} />
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: '700', color: '#fff', margin: '0 0 6px 0' }}>Caretaker Field Portal</h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                Field staff log water and electricity meters via secure mobile PIN with photo proof and automatic tariff calculations.
              </p>
              <div className="magic-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', color: '#818cf8', cursor: 'pointer' }}>
                <span>See mobile field demo</span>
                <ArrowRight size={14} />
              </div>
            </div>

          </div>

          {/* CARD 3: LIVE CCTV SURVEILLANCE & SMART GATE (SPAN 1) */}
          <div className="magic-bento-card magic-span-1">
            
            {/* RICH TOP GRAPHICAL PREVIEW */}
            <div className="magic-bg-graphic" style={{ height: '220px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'radial-gradient(ellipse at top right, rgba(245, 158, 11, 0.15), rgba(9, 13, 22, 0.95))' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444', fontWeight: '700', fontSize: '10px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                  REC • {cctvFeeds[activeCctvFeed]?.name}
                </div>
                <span style={{ fontSize: '9px', color: '#64748b' }}>{cctvFeeds[activeCctvFeed]?.res}</span>
              </div>

              {/* ANPR HUD OVERLAY */}
              <div style={{ background: '#000', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '9px', color: '#64748b' }}>ACTIVE TARGET</span>
                  <span style={{ fontSize: '8px', color: '#10b981', fontWeight: '700', background: 'rgba(16, 185, 129, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>● LIVE</span>
                </div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#fff', marginBottom: '2px' }}>{cctvFeeds[activeCctvFeed]?.target}</div>
                <div style={{ fontSize: '9px', color: '#f59e0b', fontFamily: 'monospace' }}>RTSP://192.168.1.120:554/ch1</div>
              </div>

              {/* SWITCHER CHIPS */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setActiveCctvFeed('gate')}
                  style={{ flex: 1, padding: '4px', borderRadius: '4px', fontSize: '9px', fontWeight: '700', border: 'none', cursor: 'pointer', background: activeCctvFeed === 'gate' ? '#f59e0b' : 'rgba(255,255,255,0.04)', color: activeCctvFeed === 'gate' ? '#000' : '#94a3b8' }}
                >
                  Gate 01
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCctvFeed('parking')}
                  style={{ flex: 1, padding: '4px', borderRadius: '4px', fontSize: '9px', fontWeight: '700', border: 'none', cursor: 'pointer', background: activeCctvFeed === 'parking' ? '#f59e0b' : 'rgba(255,255,255,0.04)', color: activeCctvFeed === 'parking' ? '#000' : '#94a3b8' }}
                >
                  Parking A
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCctvFeed('lobby')}
                  style={{ flex: 1, padding: '4px', borderRadius: '4px', fontSize: '9px', fontWeight: '700', border: 'none', cursor: 'pointer', background: activeCctvFeed === 'lobby' ? '#f59e0b' : 'rgba(255,255,255,0.04)', color: activeCctvFeed === 'lobby' ? '#000' : '#94a3b8' }}
                >
                  Lobby
                </button>
              </div>
            </div>

            {/* BOTTOM CARD CONTENT */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', marginBottom: '14px' }}>
                <Camera size={22} />
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: '700', color: '#fff', margin: '0 0 6px 0' }}>Live CCTV Security Oversight</h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                Stream RTSP camera feeds and monitor barrier access directly from your landlord dashboard with zero NVR port forwarding.
              </p>
              <div className="magic-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', color: '#818cf8', cursor: 'pointer' }}>
                <span>Configure IP cameras</span>
                <ArrowRight size={14} />
              </div>
            </div>

          </div>

          {/* CARD 4: AUTOMATED RENT ROLLS & SMS DISPATCH (SPAN 2) */}
          <div className="magic-bento-card magic-span-2">
            
            {/* RICH TOP GRAPHICAL PREVIEW */}
            <div className="magic-bg-graphic" style={{ height: '220px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'radial-gradient(ellipse at top left, rgba(99, 102, 241, 0.15), rgba(9, 13, 22, 0.95))' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Receipt size={14} style={{ color: '#818cf8' }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#fff' }}>BATCH RENT ROLL & SMS ENGINE</span>
                </div>
                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: '700', background: 'rgba(16, 185, 129, 0.15)', padding: '2px 8px', borderRadius: '10px' }}>
                  36 / 36 Dispatched (100%)
                </span>
              </div>

              {/* DISPATCH ROWS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', margin: '8px 0' }}>
                
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>Unit 101 • Peter K.</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#fff', margin: '2px 0' }}>KES 31,200</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#10b981', fontWeight: '700' }}>
                    <span>Rent+Water</span>
                    <span>SMS Sent ✓</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>Unit 102 • Sarah M.</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#fff', margin: '2px 0' }}>KES 47,100</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#10b981', fontWeight: '700' }}>
                    <span>Rent+Water</span>
                    <span>SMS Sent ✓</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>Unit 103 • Brian O.</div>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: '#fff', margin: '2px 0' }}>KES 56,800</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#10b981', fontWeight: '700' }}>
                    <span>Rent+Water</span>
                    <span>SMS Sent ✓</span>
                  </div>
                </div>

              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#94a3b8', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '6px' }}>
                <span>Scheduled 1st of Month Auto-Run</span>
                <span style={{ color: '#818cf8', fontWeight: '700' }}>Includes M-Pesa STK Push Link</span>
              </div>
            </div>

            {/* BOTTOM CARD CONTENT */}
            <div style={{ marginTop: '20px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8', marginBottom: '14px' }}>
                <Receipt size={22} />
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: '700', color: '#fff', margin: '0 0 6px 0' }}>Automated Rent Rolls & SMS Dispatch</h3>
              <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                Generate consolidated rent, water, and service charge rolls in 1 click. Branded PDF invoices and payment links are dispatched automatically via SMS.
              </p>
              <div className="magic-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', color: '#818cf8', cursor: 'pointer' }}>
                <span>View sample invoice</span>
                <ArrowRight size={14} />
              </div>
            </div>

          </div>

          {/* CARD 5: MULTI-ESTATE CRM & KRA TAX AUDITS (SPAN 3) */}
          <div className="magic-bento-card magic-span-3">
            
            {/* RICH TOP GRAPHICAL PREVIEW */}
            <div className="magic-bg-graphic" style={{ height: '180px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'radial-gradient(ellipse at center, rgba(192, 132, 252, 0.12), rgba(9, 13, 22, 0.95))' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building2 size={15} style={{ color: '#c084fc' }} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#fff' }}>MULTI-ESTATE CRM & KRA TAX DECLARATION SUITE</span>
                </div>
                <span style={{ fontSize: '10px', color: '#10b981', fontWeight: '700', background: 'rgba(16, 185, 129, 0.15)', padding: '2px 8px', borderRadius: '10px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  ✓ KRA eTIMS Validated
                </span>
              </div>

              {/* 3-COLUMN PORTFOLIO STATS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#fff', fontWeight: '700' }}>
                    <span>Kilimani Heights</span>
                    <span style={{ color: '#10b981' }}>100%</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', margin: '2px 0' }}>36 Units • Caretaker: J. Mwangi</div>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: '#10b981' }} />
                  </div>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#fff', fontWeight: '700' }}>
                    <span>Westlands Square</span>
                    <span style={{ color: '#38bdf8' }}>96%</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', margin: '2px 0' }}>48 Units • Caretaker: E. Kimani</div>
                  <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: '96%', height: '100%', background: '#38bdf8' }} />
                  </div>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>August Net Rent Collected</div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#10b981' }}>KES 4,772,000</div>
                  <div style={{ fontSize: '9px', color: '#64748b' }}>Withholding Tax: KES 357,900</div>
                </div>

              </div>

              {/* ACTION PILLS */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px' }}>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <span style={{ background: 'rgba(255, 255, 255, 0.06)', color: '#cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>PDF Summary</span>
                  <span style={{ background: 'rgba(255, 255, 255, 0.06)', color: '#cbd5e1', padding: '3px 8px', borderRadius: '4px' }}>Excel Ledger</span>
                </div>
                <span style={{ color: '#c084fc', fontWeight: '700' }}>1-Click eTIMS Fiscal Export</span>
              </div>
            </div>

            {/* BOTTOM CARD CONTENT */}
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ maxWidth: '780px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(192, 132, 252, 0.15)', border: '1px solid rgba(192, 132, 252, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc', marginBottom: '14px' }}>
                  <Building2 size={22} />
                </div>
                <h3 style={{ fontSize: '19px', fontWeight: '700', color: '#fff', margin: '0 0 6px 0' }}>Multi-Property Portfolio & KRA Tax Compliance</h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: 0 }}>
                  Manage multiple estates, assign caretakers with individual permissions, track tenant turnover, and export auditor-approved P&L and KRA withholding tax reports.
                </p>
              </div>
              <div className="magic-cta" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', color: '#818cf8', cursor: 'pointer', flexShrink: 0 }}>
                <span>Explore portfolio tools</span>
                <ArrowRight size={14} />
              </div>
            </div>

          </div>

        </div>

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
