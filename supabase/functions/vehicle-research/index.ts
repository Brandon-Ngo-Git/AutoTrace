const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type NhtsaRecord = Record<string, unknown>

const modelAliases: Record<string, Record<string, string>> = {
  BMW: {
    '330I': '3 SERIES',
    '330E': '3 SERIES',
    '340I': '3 SERIES',
    M340I: '3 SERIES',
    '320I': '3 SERIES',
    '530I': '5 SERIES',
    '540I': '5 SERIES',
  },
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizedName(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]
    previous[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex]
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
      diagonal = above
    }
  }
  return previous[right.length]
}

async function resolveModel(make: string, model: string, year: number) {
  const makeKey = normalizedName(make)
  const modelKey = normalizedName(model)
  const alias = modelAliases[makeKey]?.[modelKey]
  if (alias) return { model: alias, matched: true }

  const url = new URL(
    `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}`,
  )
  url.searchParams.set('format', 'json')

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error(`vPIC returned HTTP ${response.status}`)
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || !('Results' in payload) || !Array.isArray(payload.Results)) {
      throw new Error('vPIC returned an unexpected model catalog response')
    }

    const models = payload.Results
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => item.Model_Name)
      .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    const exactMatch = models.find((name) => normalizedName(name) === modelKey)
    if (exactMatch) return { model: exactMatch, matched: true }

    const candidates = models
      .map((name) => ({ name, distance: editDistance(modelKey, normalizedName(name)) }))
      .filter(({ distance }) => distance <= Math.max(1, Math.floor(modelKey.length * 0.2)))
      .sort((left, right) => left.distance - right.distance)
    if (candidates.length > 0 && candidates[0].distance < (candidates[1]?.distance ?? Infinity)) {
      return { model: candidates[0].name, matched: true }
    }
  } catch (error) {
    console.error('Could not resolve the NHTSA model name:', error)
  }

  return { model, matched: false }
}

async function getVehicleOptions(action: 'makes' | 'models', make?: string, year?: number) {
  const url = action === 'makes'
    ? new URL('https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car')
    : new URL(
      `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(make ?? '')}/modelyear/${year}`,
    )
  url.searchParams.set('format', 'json')

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`vPIC returned HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || !('Results' in payload) || !Array.isArray(payload.Results)) {
    throw new Error('vPIC returned an unexpected vehicle catalog response')
  }

  const names = payload.Results
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => action === 'makes' ? item.MakeName : item.Model_Name)
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))

  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

async function fetchNhtsaRecords(endpoint: string, make: string, model: string, year: number) {
  const url = new URL(`https://api.nhtsa.gov/${endpoint}`)
  url.searchParams.set('make', make)
  url.searchParams.set('model', model)
  url.searchParams.set('modelYear', String(year))

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`NHTSA returned invalid JSON for ${endpoint}`)
  }

  const result = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  if (
    response.status === 400
    && result?.Count === 0
    && Array.isArray(result.results)
    && result.results.length === 0
  ) {
    return []
  }
  if (!response.ok) throw new Error(`NHTSA returned HTTP ${response.status} for ${endpoint}`)
  if (!result || !Array.isArray(result.results)) {
    throw new Error(`NHTSA returned an unexpected response for ${endpoint}`)
  }

  return result.results.filter((item): item is NhtsaRecord => Boolean(item && typeof item === 'object'))
}

function recordText(record: NhtsaRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) return text
    }
  }
  return ''
}

function parseDate(value: string) {
  const dayFirst = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dayFirst) return new Date(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]))
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(value: string) {
  const date = parseDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(date)
    : 'Date not reported'
}

function categoryColor(category: string) {
  const normalized = category.toLowerCase()
  if (normalized.includes('engine') || normalized.includes('fuel') || normalized.includes('powertrain')) return 'orange'
  if (normalized.includes('electrical') || normalized.includes('electronic')) return 'violet'
  if (normalized.includes('brake')) return 'green'
  return 'blue'
}

async function getResearch(make: string, model: string, startYear: number, endYear: number) {
  const resolved = await resolveModel(make, model, startYear)
  const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
  const complaintsByYear: Record<number, NhtsaRecord[]> = {}
  const recallsByYear: Record<number, NhtsaRecord[]> = {}

  for (let index = 0; index < years.length; index += 4) {
    const yearBatch = years.slice(index, index + 4)
    const results = await Promise.all(yearBatch.map(async (year) => {
      const [complaints, recalls] = await Promise.all([
        fetchNhtsaRecords('complaints/complaintsByVehicle', make, resolved.model, year),
        fetchNhtsaRecords('recalls/recallsByVehicle', make, resolved.model, year),
      ])
      return { year, complaints, recalls }
    }))
    for (const result of results) {
      complaintsByYear[result.year] = result.complaints
      recallsByYear[result.year] = result.recalls
    }
  }

  const complaints = new Map<string, NhtsaRecord & { modelYear: number }>()
  const recalls = new Map<string, NhtsaRecord & { modelYear: number }>()
  const trend = years.map((year) => {
    const yearComplaints = complaintsByYear[year]
    for (const item of yearComplaints) {
      const reportNumber = recordText(item, 'odiNumber')
      if (!reportNumber) continue
      complaints.set(reportNumber, { ...item, modelYear: year })
    }
    for (const item of recallsByYear[year]) {
      const campaign = recordText(item, 'NHTSACampaignNumber', 'campaignNumber')
      if (campaign) recalls.set(campaign, { ...item, modelYear: year })
    }
    return { year: String(year), reports: yearComplaints.length }
  })

  const allComplaints = [...complaints.values()]
  const allRecalls = [...recalls.values()]
  const categoryCounts = new Map<string, number>()
  for (const complaint of allComplaints) {
    const category = recordText(complaint, 'components') || 'Uncategorized'
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
  }
  const categories = [...categoryCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([name, count]) => ({
      name,
      count,
      share: allComplaints.length ? Math.round(count * 100 / allComplaints.length) : 0,
      color: categoryColor(name),
    }))

  const recentComplaints = allComplaints
    .sort((left, right) => (parseDate(recordText(right, 'dateComplaintFiled'))?.getTime() ?? 0)
      - (parseDate(recordText(left, 'dateComplaintFiled'))?.getTime() ?? 0))
    .slice(0, 5)
    .map((complaint) => {
      const component = recordText(complaint, 'components') || 'Uncategorized'
      return {
        date: formatDate(recordText(complaint, 'dateComplaintFiled')),
        year: complaint.modelYear,
        component,
        title: recordText(complaint, 'summary').slice(0, 150) || 'Complaint narrative not provided',
        report: recordText(complaint, 'odiNumber'),
        color: categoryColor(component),
      }
    })

  const recallTrend = years.map((year) => ({
    year: String(year),
    recalls: new Set(recallsByYear[year]
      .map((recall) => recordText(recall, 'NHTSACampaignNumber', 'campaignNumber'))
      .filter(Boolean)).size,
  }))
  const recallItems = allRecalls
    .sort((left, right) => (parseDate(recordText(right, 'ReportReceivedDate', 'reportDate'))?.getTime() ?? 0)
      - (parseDate(recordText(left, 'ReportReceivedDate', 'reportDate'))?.getTime() ?? 0))
    .slice(0, 10)
    .map((recall) => ({
      campaign: recordText(recall, 'NHTSACampaignNumber', 'campaignNumber'),
      date: formatDate(recordText(recall, 'ReportReceivedDate', 'reportDate')),
      component: recordText(recall, 'Component') || 'Uncategorized',
      title: recordText(recall, 'Summary').slice(0, 150) || 'Recall summary not provided',
      consequence: recordText(recall, 'Consequence'),
      remedy: recordText(recall, 'Remedy'),
    }))

  const makeLabel = make.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
  const modelLabel = resolved.model.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
  const matchedYears = resolved.matched || allComplaints.length > 0 || allRecalls.length > 0 ? years.length : 0

  return {
    vehicleLabel: `${makeLabel} ${modelLabel}`,
    matchedVehicles: matchedYears,
    yearRange: [startYear, endYear],
    reports: trend.reduce((total, item) => total + item.reports, 0),
    recalls: allRecalls.length,
    investigations: 0,
    anomalies: [],
    trend,
    recallTrend,
    categories,
    complaints: recentComplaints,
    recallItems,
    investigationItems: [],
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  let requestBody: unknown
  try {
    requestBody = await request.json()
  } catch {
    return respond({ error: 'Request body must be valid JSON' }, 400)
  }
  if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
    return respond({ error: 'Request body must be a JSON object' }, 400)
  }
  const payload = requestBody as Record<string, unknown>

  if (payload.action === 'makes') {
    try {
      return respond({ options: await getVehicleOptions('makes') })
    } catch (error) {
      console.error('Could not load NHTSA vehicle makes:', error)
      return respond({ error: 'Could not load vehicle makes from NHTSA.' }, 502)
    }
  }
  if (payload.action === 'models') {
    const make = typeof payload.make === 'string' ? payload.make.trim() : ''
    const year = payload.year
    if (
      !make
      || make.length > 50
      || !Number.isInteger(year)
      || Number(year) < 1981
      || Number(year) > new Date().getFullYear() + 1
    ) {
      return respond({ error: 'Provide a valid make and model year' }, 400)
    }
    try {
      return respond({ options: await getVehicleOptions('models', make, Number(year)) })
    } catch (error) {
      console.error('Could not load NHTSA vehicle models:', error)
      return respond({ error: 'Could not load vehicle models from NHTSA.' }, 502)
    }
  }

  const make = typeof payload.make === 'string' ? payload.make.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model.trim() : ''
  const years = payload.years
  if (!make || make.length > 50 || !model || model.length > 80) {
    return respond({ error: 'Provide a valid make and model' }, 400)
  }
  if (
    !Array.isArray(years)
    || years.length !== 2
    || !years.every((year) => Number.isInteger(year) && year >= 1980 && year <= new Date().getFullYear() + 1)
    || Number(years[0]) > Number(years[1])
    || Number(years[1]) - Number(years[0]) > 15
  ) {
    return respond({ error: 'Provide a valid model-year range of at most 16 years' }, 400)
  }

  try {
    return respond(await getResearch(make, model, Number(years[0]), Number(years[1])))
  } catch (error) {
    console.error('NHTSA vehicle research failed:', error)
    return respond({ error: 'Could not retrieve vehicle research from NHTSA. Please try again.' }, 502)
  }
})
