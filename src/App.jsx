import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Gauge,
  Info,
  Menu,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import './App.css'
import VehiclePicker from './components/VehiclePicker.jsx'

const TrendChart = lazy(() => import('./components/TrendChart.jsx'))

const demoResearch = {
  vehicleLabel: 'BMW 330i',
  yearRange: [2017, 2020],
  reports: 1284,
  recalls: 7,
  investigations: 2,
  anomalies: [],
  trend: [
    { year: '2017', reports: 412 },
    { year: '2018', reports: 368 },
    { year: '2019', reports: 291 },
    { year: '2020', reports: 213 },
  ],
  recallTrend: [
    { year: '2017', recalls: 3 },
    { year: '2018', recalls: 1 },
    { year: '2019', recalls: 2 },
    { year: '2020', recalls: 1 },
  ],
  recallItems: [
    { campaign: '20V-601', date: 'Oct 02, 2020', component: 'Fuel system', title: 'Fuel pump may fail and cause engine stall' },
    { campaign: '19V-513', date: 'Jul 12, 2019', component: 'Electrical system', title: 'Electrical connection may overheat' },
  ],
  investigationItems: [
    { nhtsaId: 'PE20-001', subject: 'Engine stalling reports', date: 'Jan 08, 2020', status: 'Closed', summary: 'Preliminary review of consumer-submitted vehicle stall reports.' },
    { nhtsaId: 'EA19-002', subject: 'Fuel system review', date: 'Aug 19, 2019', status: 'Closed', summary: 'Engineering analysis concerning fuel system reports.' },
  ],
  categories: [
    { name: 'Engine & powertrain', count: 326, share: 25, color: 'blue' },
    { name: 'Electrical system', count: 269, share: 21, color: 'violet' },
    { name: 'Fuel system', count: 205, share: 16, color: 'orange' },
    { name: 'Brakes', count: 154, share: 12, color: 'green' },
  ],
  complaints: [
    { date: 'May 14, 2020', year: 2019, component: 'Engine', title: 'Engine stalled while driving at highway speed', report: '11327482', color: 'orange' },
    { date: 'Apr 29, 2020', year: 2018, component: 'Electrical', title: 'Vehicle shut down and would not restart', report: '11321865', color: 'violet' },
    { date: 'Mar 08, 2020', year: 2017, component: 'Fuel system', title: 'Fuel pump failure caused sudden loss of power', report: '11294810', color: 'blue' },
  ],
}

const demoComparison = {
  vehicleLabel: 'Audi A4',
  yearRange: [2017, 2020],
  reports: 846,
  categories: [
    { name: 'Electrical system', count: 214, share: 25 },
    { name: 'Engine & powertrain', count: 186, share: 22 },
    { name: 'Fuel system', count: 127, share: 15 },
  ],
}

const chartModes = {
  overview: { title: 'Complaints by model year', caption: 'Individual reports submitted to NHTSA', values: 'reports' },
  issues: { title: 'Issue reports by model year', caption: 'Reported problems across selected model years', values: 'reports' },
  recalls: { title: 'Safety recalls by model year', caption: 'Recall campaigns associated with this vehicle', values: 'recalls' },
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value)
}

function App() {
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedEndYear, setSelectedEndYear] = useState('')
  const [selectedMake, setSelectedMake] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [activeSection, setActiveSection] = useState('overview')
  const [activeChart, setActiveChart] = useState('overview')
  const [research, setResearch] = useState(demoResearch)
  const [isDemo, setIsDemo] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [showSignIn, setShowSignIn] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const [comparisonYear, setComparisonYear] = useState('')
  const [comparisonEndYear, setComparisonEndYear] = useState('')
  const [comparisonMake, setComparisonMake] = useState('')
  const [comparisonModel, setComparisonModel] = useState('')
  const [comparisonData, setComparisonData] = useState(demoComparison)
  const [comparisonDemo, setComparisonDemo] = useState(true)
  const [comparing, setComparing] = useState(false)
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [user, setUser] = useState(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [savedQueries, setSavedQueries] = useState([])
  const query = `${selectedYear}${selectedEndYear ? `-${selectedEndYear}` : ''} ${selectedMake} ${selectedModel}`.trim()
  const hasSelection = Boolean(selectedYear && selectedMake && selectedModel)
  const isSaved = savedQueries.includes(query)

  useEffect(() => {
    if (!supabase) return undefined

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(`Could not restore your session: ${sessionError.message}`)
      setUser(data.session?.user ?? null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSavedQueries([])
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !user) return undefined

    let active = true
    supabase.from('saved_searches').select('query').eq('user_id', user.id).then(({ data, error: savedError }) => {
      if (!active) return
      if (savedError) {
        setError(`Could not load saved research: ${savedError.message}`)
        return
      }
      setSavedQueries(data.map((item) => item.query))
    })

    return () => { active = false }
  }, [user])

  const mode = chartModes[activeChart]
  const firstYearReports = research.trend[0]?.reports ?? 0
  const lastYearReports = research.trend.at(-1)?.reports ?? 0
  const reportChange = firstYearReports > 0
    ? Math.round(((lastYearReports - firstYearReports) / firstYearReports) * 100)
    : null
  const primaryCategory = research.categories[0]?.name ?? 'reported issues'
  const anomalyYears = research.anomalies ?? []
  const chartData = useMemo(() => {
    return activeChart === 'recalls' ? research.recallTrend ?? [] : research.trend
  }, [activeChart, research.recallTrend, research.trend])

  async function searchVehicle(event) {
    event?.preventDefault()
    if (!hasSelection) {
      setError('Choose a year, make, and model before searching.')
      return
    }

    setError('')
    setSearching(true)
    if (!supabase) {
      setSearching(false)
      const isSampleSearch = selectedMake.toLowerCase() === 'bmw'
        && selectedModel.toLowerCase() === '330i'
        && selectedYear === '2018'
        && (!selectedEndYear || selectedEndYear === '2018')
      if (!isSampleSearch) {
        setError('Live vehicle search is unavailable. The sample workspace only includes illustrative 2018 BMW 330i data.')
        return
      }
      setResearch({
        ...demoResearch,
        yearRange: [2018, 2018],
        reports: 368,
        recalls: 1,
        trend: demoResearch.trend.filter((item) => item.year === '2018'),
        recallTrend: demoResearch.recallTrend.filter((item) => item.year === '2018'),
        complaints: demoResearch.complaints.filter((item) => item.year === 2018),
      })
      setIsDemo(true)
      return
    }

    const { data, error: searchError } = await supabase.functions.invoke('vehicle-research', {
      body: {
        make: selectedMake,
        model: selectedModel,
        years: [Number(selectedYear), Number(selectedEndYear || selectedYear)],
      },
    })

    setSearching(false)
    if (searchError) {
      setError(`Live search failed: ${searchError.message}. Check your Supabase Edge Function configuration.`)
      return
    }
    if (data?.matchedVehicles === 0) {
      setError('No NHTSA model records matched this search. Check the make, model, and year, or try the model name used by NHTSA.')
      return
    }
    if (!data?.trend || !Array.isArray(data.categories)) {
      setError('The research service returned an unexpected response. Check the Edge Function setup.')
      return
    }
    setResearch(data)
    setIsDemo(false)
  }

  async function signIn(event) {
    event.preventDefault()
    if (!supabase) {
      setAuthMessage('Add your Supabase URL and publishable key to enable sign-in.')
      return
    }
    const { error: signInError } = await supabase.auth.signInWithOtp({ email })
    setAuthMessage(signInError ? `Sign-in failed: ${signInError.message}` : 'Check your email for a secure sign-in link.')
  }

  async function signOut() {
    if (!supabase) return
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(`Could not sign out: ${signOutError.message}`)
  }

  async function toggleSavedSearch() {
    if (!hasSelection) {
      setError('Choose a year, make, and model before saving this research.')
      return
    }
    if (!supabase || !user) {
      setShowSignIn(true)
      return
    }

    if (isSaved) {
      const { error: deleteError } = await supabase.from('saved_searches')
        .delete()
        .eq('user_id', user.id)
        .eq('query', query)
      if (deleteError) {
        setError(`Could not remove saved research: ${deleteError.message}`)
        return
      }
      setSavedQueries((current) => current.filter((savedQuery) => savedQuery !== query))
      return
    }

    const { error: saveError } = await supabase.from('saved_searches')
      .insert({ user_id: user.id, query })
    if (saveError) {
      setError(`Could not save this research: ${saveError.message}`)
      return
    }
    setSavedQueries((current) => [...current, query])
  }

  async function compareVehicle(event) {
    event.preventDefault()
    if (!comparisonYear || !comparisonMake || !comparisonModel) {
      setError('Choose a start year, make, and model for the comparison.')
      return
    }
    if (comparisonEndYear && Number(comparisonEndYear) < Number(comparisonYear)) {
      setError('The comparison end year must be the same as or later than its start year.')
      return
    }
    if (!supabase) {
      const isSampleComparison = comparisonMake.toLowerCase() === 'audi'
        && comparisonModel.toLowerCase() === 'a4'
        && comparisonYear === '2018'
        && (!comparisonEndYear || comparisonEndYear === '2018')
      if (!isSampleComparison) {
        setError('Live comparison is unavailable. The sample workspace only includes illustrative 2018 Audi A4 data.')
        return
      }
      setComparisonData({ ...demoComparison, yearRange: [2018, 2018] })
      setComparisonDemo(true)
      return
    }

    setComparing(true)
    const { data, error: compareError } = await supabase.functions.invoke('vehicle-research', {
      body: {
        make: comparisonMake,
        model: comparisonModel,
        years: [Number(comparisonYear), Number(comparisonEndYear || comparisonYear)],
      },
    })
    setComparing(false)
    if (compareError) {
      setError(`Live comparison failed: ${compareError.message}`)
      return
    }
    if (data?.matchedVehicles === 0) {
      setError('No NHTSA model records matched the comparison. Check the make, model, and year, or try the model name used by NHTSA.')
      return
    }
    if (!data?.trend || !Array.isArray(data.categories)) {
      setError('The comparison service returned an unexpected response.')
      return
    }
    setComparisonData(data)
    setComparisonDemo(false)
  }

  function downloadReport() {
    const rows = [
      ['AutoTrace vehicle research report'],
      ['Vehicle', research.vehicleLabel],
      ['Model years', `${research.yearRange[0]}–${research.yearRange[1]}`],
      ['Data source', isDemo ? 'Illustrative sample data — not NHTSA results' : 'NHTSA complaints and recalls'],
      ['Complaint reports', research.reports],
      ['Reported recalls', research.recalls],
      ['Open investigations', research.investigations],
      [],
      ['Model year', 'Complaint reports'],
      ...research.trend.map((item) => [item.year, item.reports]),
      [],
      ['Reported issue category', 'Reports', 'Share of complaints'],
      ...research.categories.map((item) => [item.name, item.count, `${item.share}%`]),
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `autotrace-${research.vehicleLabel.toLowerCase().replaceAll(/\s+/g, '-')}-report.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function selectSection(section) {
    setActiveSection(section)
    if (section === 'issues') setActiveChart('issues')
    if (section === 'recalls') setActiveChart('recalls')
    if (section === 'overview') setActiveChart('overview')
    setMobileNavOpen(false)
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" aria-label="AutoTrace home" onClick={() => selectSection('overview')}>
          <span className="brand-mark"><Activity size={21} strokeWidth={2.7} /></span>
          <span>auto<span className="brand-light">trace</span></span>
        </a>

        <div className="workspace-label">RESEARCH WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={`nav-item ${activeSection === 'overview' ? 'nav-active' : ''}`} onClick={() => selectSection('overview')}>
            <Gauge size={17} /> Overview
          </button>
          <button className={`nav-item ${activeSection === 'issues' ? 'nav-active' : ''}`} onClick={() => selectSection('issues')}>
            <SlidersHorizontal size={17} /> Reported issues
          </button>
          <button className={`nav-item ${activeSection === 'recalls' ? 'nav-active' : ''}`} onClick={() => selectSection('recalls')}>
            <ShieldAlert size={17} /> Recalls & investigations
          </button>
        </nav>

        <div className="sidebar-divider" />
        <div className="workspace-label">YOUR GARAGE</div>
        <button className="nav-item" onClick={() => setError(savedQueries.length ? `You have ${savedQueries.length} saved vehicle ${savedQueries.length === 1 ? 'search' : 'searches'}.` : 'Save a vehicle search to build your garage.')}>
        <Bookmark size={17} /> Saved vehicles <span className="nav-count">{savedQueries.length}</span>
        </button>
        <button className="nav-item" onClick={() => setShowSignIn(true)}>
          <CarFront size={17} /> Compare vehicles
        </button>

        <div className="sidebar-bottom">
          <div className="data-note">
            <span className="data-note-icon"><Info size={15} /></span>
            <div>
              <strong>Know what the data says</strong>
              <p>Complaint reports are not failure rates. Reports are voluntary and self-selected.</p>
            </div>
          </div>
          <button className="help-link" onClick={() => setError('AutoTrace summarizes public NHTSA reports. Complaint volume is not a measure of defect prevalence or vehicle reliability.')}>
            <CircleHelp size={16} /> How to read this data <ArrowRight size={14} />
          </button>
          <div className="profile-row">
            <div className="avatar">{user ? (user.email?.[0] ?? 'U').toUpperCase() : 'G'}</div>
            <div className="profile-copy"><strong>{user?.email ?? 'Guest researcher'}</strong><span>{user ? 'Signed in' : 'Free research access'}</span></div>
            {user ? <button className="icon-button profile-action" aria-label="Sign out" onClick={signOut}><ExternalLink size={15} /></button> : <button className="sign-in-link" onClick={() => setShowSignIn(true)}>Sign in</button>}
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open menu" onClick={() => setMobileNavOpen((value) => !value)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Research</span><ChevronRight size={14} /><strong>Vehicle overview</strong></div>
          <div className="topbar-actions">
            <span className={`connection-status ${supabase ? 'status-connected' : ''}`}><span />{supabase ? 'Supabase connected' : 'Sample workspace'}</span>
            {user ? <button className="user-chip" onClick={signOut}>{user.email?.split('@')[0]} <ChevronDown size={14} /></button> : <button className="top-signin" onClick={() => setShowSignIn(true)}>Sign in <ArrowRight size={14} /></button>}
          </div>
        </header>

        <div className="content-wrap">
          <section className="search-section">
            <div className="eyebrow"><span className="live-dot" /> THE VEHICLE RELIABILITY RESEARCH ENGINE</div>
            <h1>Research a vehicle.<br /><span>See the whole picture.</span></h1>
            <p className="intro-copy">Explore reported problems, safety recalls, and trends across model years — all in one place.</p>
            <form className="search-form" onSubmit={searchVehicle}>
              <VehiclePicker
                year={selectedYear}
                endYear={selectedEndYear}
                make={selectedMake}
                model={selectedModel}
                onYearChange={(value) => {
                  setSelectedYear(value)
                  setSelectedEndYear('')
                  setSelectedModel('')
                }}
                onEndYearChange={setSelectedEndYear}
                onMakeChange={setSelectedMake}
                onModelChange={setSelectedModel}
                onError={setError}
                disabled={searching}
              />
              <button type="submit" disabled={searching || !hasSelection}>
                {searching ? <span className="spinner" /> : <>Research vehicle <ArrowRight size={16} /></>}
              </button>
            </form>
            <div className="search-hint">
              <Sparkles size={14} />
              {supabase
                ? 'Choose a start year; optionally select an end year to search a range'
                : 'Sample vehicle list shown — connect Supabase to browse the full NHTSA catalog'}
            </div>
          </section>

          {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}</span><button aria-label="Dismiss message" onClick={() => setError('')}><X size={16} /></button></div>}

          <section className="results-section">
            <div className="results-heading">
              <div>
                <div className="section-kicker">VEHICLE RESEARCH</div>
                <h2>{research.vehicleLabel} <span className="year-pill">{research.yearRange[0]}–{research.yearRange[1]}</span></h2>
                <p className="result-subtitle">A closer look at complaints filed for this model range</p>
              </div>
              <div className="results-actions">
                <button className={`save-button ${isSaved ? 'is-saved' : ''}`} onClick={toggleSavedSearch}><Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} /> {isSaved ? 'Saved' : 'Save vehicle'}</button>
                <button className="export-button" onClick={downloadReport}><Download size={16} /> Export report</button>
              </div>
            </div>

            {isDemo && <div className="demo-banner"><Info size={16} /><span><strong>Illustrative sample data</strong> — these numbers are for demonstration only and do not represent verified NHTSA complaint totals.</span><button onClick={() => setError('Configure VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then deploy the vehicle-research Edge Function to query connected NHTSA data.')}>Connect data <ArrowRight size={14} /></button></div>}

            <div className="stat-grid">
              <article className="stat-card">
                <div className="stat-label">COMPLAINT REPORTS <span className="info-small" title="Voluntary reports submitted to NHTSA, not a failure rate"><Info size={14} /></span></div>
                <div className="stat-main"><strong>{formatNumber(research.reports)}</strong><span className="stat-suffix">reports</span></div>
                <div className="stat-foot"><span className="trend-volume">{reportChange === null ? '—' : <>{reportChange > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{reportChange > 0 ? '+' : ''}{reportChange}%</>}</span> reported volume across range</div>
                <div className="stat-icon icon-blue"><FileText size={18} /></div>
              </article>
              <article className="stat-card">
                <div className="stat-label">REPORTED ISSUE CATEGORIES <span className="info-small" title="Categories are grouped from complaint narratives"><Info size={14} /></span></div>
                <div className="stat-main"><strong>{research.categories.length}</strong><span className="stat-suffix">patterns</span></div>
                <div className="stat-foot"><span className="sparkle-foot"><Sparkles size={13} /> NLP grouped</span> from narratives</div>
                <div className="stat-icon icon-violet"><Sparkles size={18} /></div>
              </article>
              <article className="stat-card">
                <div className="stat-label">RECALL CAMPAIGNS <span className="info-small" title="NHTSA recall campaigns are not complaint reports"><Info size={14} /></span></div>
                <div className="stat-main"><strong>{research.recalls}</strong><span className="stat-suffix">campaigns</span></div>
                <div className="stat-foot"><span className="stat-neutral">NHTSA safety recalls</span></div>
                <div className="stat-icon icon-orange"><ShieldAlert size={18} /></div>
              </article>
              <article className="stat-card">
                <div className="stat-label">INVESTIGATIONS <span className="info-small" title="Investigations are reviewed separately from recalls"><Info size={14} /></span></div>
                <div className="stat-main"><strong>{research.investigations}</strong><span className="stat-suffix">records</span></div>
                <div className="stat-foot"><span className="stat-neutral">NHTSA investigations</span></div>
                <div className="stat-icon icon-green"><Activity size={18} /></div>
              </article>
            </div>

            <div className="dashboard-grid">
              <section className="panel trend-panel">
                <div className="panel-header">
                  <div>
                    <h3>{mode.title}</h3>
                    <p>{mode.caption}</p>
                  </div>
                  <button className="filter-button" onClick={() => setActiveChart(activeChart === 'overview' ? 'issues' : 'overview')}><CalendarDays size={15} /> Model years <ChevronDown size={14} /></button>
                </div>
                <div className="chart-legend"><span className={`legend-dot ${activeChart === 'recalls' ? 'legend-orange' : ''}`} /> {activeChart === 'recalls' ? 'Recall campaigns' : 'Complaint reports'} <span className="chart-source">{isDemo ? 'Sample data' : 'NHTSA data'}</span></div>
                <div className="chart-wrap">
                  <Suspense fallback={<div className="chart-loading">Preparing interactive chart…</div>}>
                    <TrendChart data={chartData} dataKey={mode.values} color={activeChart === 'recalls' ? '#e98653' : '#4465e8'} />
                  </Suspense>
                </div>
                <div className="chart-insight"><Sparkles size={15} /><span><strong>Pattern to explore</strong> — {anomalyYears.length > 0 ? `Unusual report volume was flagged for ${anomalyYears.map((item) => item.year).join(', ')} for further review.` : reportChange === null ? 'Not enough data to calculate a year-over-year pattern.' : `Reported volume ${reportChange > 0 ? 'increased' : reportChange < 0 ? 'decreased' : 'was unchanged'} by ${Math.abs(reportChange)}% between the first and last model years.`} This describes reports received, not the likelihood of a vehicle problem.</span></div>
              </section>

              <section className="panel categories-panel">
                <div className="panel-header">
                  <div><h3>Most reported issues</h3><p>Narrative themes in submitted complaints</p></div>
                  <button className="dots-button" aria-label="Filter reported issues" onClick={() => setActiveSection('issues')}><Filter size={16} /></button>
                </div>
                <div className="category-list">
                  {research.categories.slice(0, 4).map((category, index) => (
                    <button className="category-row" key={category.name} onClick={() => selectSection('issues')}>
                      <span className={`category-rank rank-${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                      <span className="category-content">
                        <span className="category-name">{category.name}</span>
                        <span className="category-bar"><i className={`bar-${category.color}`} style={{ width: `${category.share}%` }} /></span>
                      </span>
                      <span className="category-count">{formatNumber(category.count)}<small>reports</small></span>
                      <ChevronRight className="category-chevron" size={15} />
                    </button>
                  ))}
                </div>
                <button className="text-link" onClick={() => selectSection('issues')}>Explore all reported issues <ArrowRight size={15} /></button>
              </section>
            </div>

            <div className="lower-grid">
              <section className="panel complaints-panel">
                {activeSection === 'recalls' ? (
                  <>
                    <div className="panel-header">
                      <div><h3>Recall & investigation history</h3><p>Safety campaigns and NHTSA investigative records</p></div>
                      <a className="text-link header-link" href="https://www.nhtsa.gov/recalls" target="_blank" rel="noreferrer">NHTSA <ExternalLink size={13} /></a>
                    </div>
                    <div className="history-list">
                      {[...(research.recallItems ?? []).map((item) => ({ ...item, type: 'recall', id: item.campaign })), ...(research.investigationItems ?? []).map((item) => ({ ...item, type: 'investigation', id: item.nhtsaId }))].slice(0, 5).map((item) => (
                        <article className="history-row" key={`${item.type}-${item.id}`}>
                          <span className={`complaint-mark ${item.type === 'recall' ? 'mark-orange' : 'mark-violet'}`}>{item.type === 'recall' ? <ShieldAlert size={16} /> : <Activity size={16} />}</span>
                          <div className="complaint-details">
                            <strong>{item.title ?? item.subject}</strong>
                            <span><b>{item.type === 'recall' ? `Campaign ${item.campaign}` : item.nhtsaId}</b><i /> {item.component ?? item.status} <i /> {item.date}</span>
                          </div>
                          <span className={`record-type record-${item.type}`}>{item.type}</span>
                        </article>
                      ))}
                      {research.recallItems?.length === 0 && research.investigationItems?.length === 0 && <p className="empty-history">No matching recall or investigation records were returned for this search.</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="panel-header">
                      <div><h3>Recent complaint reports</h3><p>Individual NHTSA submissions — narratives may be unverified</p></div>
                      <a className="text-link header-link" href="https://www.nhtsa.gov/vehiclecomplaints" target="_blank" rel="noreferrer">NHTSA <ExternalLink size={13} /></a>
                    </div>
                    <div className="complaint-table">
                      {research.complaints.slice(0, 3).map((complaint) => (
                        <article className="complaint-row" key={complaint.report}>
                          <span className={`complaint-mark mark-${complaint.color}`}><FileText size={16} /></span>
                          <div className="complaint-details">
                            <strong>{complaint.title}</strong>
                            <span><b>{complaint.component}</b><i /> {complaint.year} {research.vehicleLabel} <i /> {complaint.date}</span>
                          </div>
                          <span className="report-number">NHTSA {complaint.report}</span>
                        </article>
                      ))}
                      {research.complaints.length === 0 && <p className="empty-history">No complaint reports were returned for this search.</p>}
                    </div>
                  </>
                )}
              </section>

              <aside className="insight-card">
                <div className="insight-topline"><span><Sparkles size={15} /> AUTOTRACE INSIGHT</span><span className="beta-tag">BETA</span></div>
                <h3>Patterns worth a closer look.</h3>
                <p>{isDemo ? 'Reports mentioning engine stalling appear across multiple model years. That can help guide research — it does not establish a defect or predict individual vehicle outcomes.' : `Narratives frequently reference ${primaryCategory.toLowerCase()}. Clustering can guide research — it does not establish a defect or predict individual vehicle outcomes.`}</p>
                <div className="insight-evidence"><span className="evidence-icon"><FileText size={15} /></span><span><strong>{isDemo ? 'Example narrative cluster' : 'Narrative cluster'}</strong><small>Based on submitted complaint text</small></span></div>
                <button className="insight-link" onClick={() => selectSection('issues')}>Review supporting reports <ArrowRight size={15} /></button>
              </aside>
            </div>

            <section className="compare-strip">
              <div className="compare-icon"><CarFront size={19} /></div>
              <div className="compare-copy"><strong>Researching alternatives?</strong><span>Compare complaint trends across similar vehicles side by side.</span></div>
              <div className="compare-mini"><span>BMW 330i</span><span className="compare-line" /><span>Audi A4</span></div>
              <button onClick={() => setShowComparison(true)}>Compare vehicles <ArrowRight size={15} /></button>
            </section>

            <footer className="page-footer">
              <div><span className="footer-mark"><Activity size={15} /></span> AutoTrace <span className="footer-separator">·</span> Research, not a verdict.</div>
              <span>Data sourced from public NHTSA records <a href="https://www.nhtsa.gov/nhtsa-datasets-and-apis" target="_blank" rel="noreferrer"><ExternalLink size={12} /></a></span>
              <span className="footer-disclaimer">Complaint reports are voluntary; counts are not failure rates.</span>
            </footer>
          </section>
        </div>
      </main>

      {showSignIn && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSignIn(false) }}>
          <section className="sign-in-modal" role="dialog" aria-modal="true" aria-labelledby="sign-in-title">
            <button className="modal-close icon-button" aria-label="Close sign-in dialog" onClick={() => setShowSignIn(false)}><X size={18} /></button>
            <span className="modal-brand"><Activity size={21} /></span>
            <div className="section-kicker">YOUR RESEARCH WORKSPACE</div>
            <h2 id="sign-in-title">{user ? 'You’re all set.' : 'Save your research.'}</h2>
            <p>Sign in to keep a garage of vehicles and pick up where you left off.</p>
            {!user && <form onSubmit={signIn}><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /><button className="modal-submit" type="submit">Email me a sign-in link <ArrowRight size={15} /></button></form>}
            {authMessage && <div className="auth-message"><Check size={15} />{authMessage}</div>}
            {!supabase && <div className="modal-demo-note"><Info size={14} /> Authentication becomes available when Supabase is configured.</div>}
          </section>
        </div>
      )}

      {showComparison && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowComparison(false) }}>
          <section className="comparison-modal" role="dialog" aria-modal="true" aria-labelledby="comparison-title">
            <button className="modal-close icon-button" aria-label="Close comparison" onClick={() => setShowComparison(false)}><X size={18} /></button>
            <div className="section-kicker">SIDE-BY-SIDE RESEARCH</div>
            <h2 id="comparison-title">Compare reported complaint volume</h2>
            <p className="comparison-disclaimer">Complaint counts are not failure rates and are not adjusted for vehicles on the road, mileage, or exposure.</p>
            <form className="comparison-search" onSubmit={compareVehicle}>
              <VehiclePicker
                year={comparisonYear}
                endYear={comparisonEndYear}
                make={comparisonMake}
                model={comparisonModel}
                onYearChange={(value) => {
                  setComparisonYear(value)
                  setComparisonEndYear('')
                  setComparisonModel('')
                }}
                onEndYearChange={setComparisonEndYear}
                onMakeChange={setComparisonMake}
                onModelChange={setComparisonModel}
                onError={setError}
                disabled={comparing}
              />
              <button type="submit" disabled={comparing || !comparisonYear || !comparisonMake || !comparisonModel}>{comparing ? 'Comparing…' : 'Compare'}</button>
            </form>
            <div className="comparison-source">{isDemo ? 'Current: illustrative sample' : 'Current: NHTSA records'} <span>·</span> {comparisonDemo ? 'Comparison: illustrative sample' : 'Comparison: NHTSA records'}</div>
            <div className="comparison-columns">
              {[research, comparisonData].map((vehicle, index) => {
                const maxReports = Math.max(research.reports, comparisonData.reports, 1)
                return (
                  <article className="comparison-card" key={`${vehicle.vehicleLabel}-${index}`}>
                    <span className="comparison-vehicle-label">{index === 0 ? 'CURRENT VEHICLE' : 'COMPARISON VEHICLE'}</span>
                    <h3>{vehicle.vehicleLabel}</h3>
                    <strong className="comparison-total">{formatNumber(vehicle.reports)}</strong>
                    <span className="comparison-total-label">complaint reports</span>
                    <span className="comparison-bar"><i style={{ width: `${(vehicle.reports / maxReports) * 100}%` }} /></span>
                    <div className="comparison-categories">
                      {(vehicle.categories ?? []).slice(0, 3).map((category) => <div key={category.name}><span>{category.name}</span><b>{formatNumber(category.count)}</b></div>)}
                    </div>
                  </article>
                )
              })}
            </div>
            <div className="comparison-footnote"><Info size={15} /> Differences in report volume alone do not indicate that one vehicle is more or less reliable.</div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
