import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const currentYear = new Date().getFullYear()
const years = Array.from({ length: currentYear + 1 - 1981 + 1 }, (_, index) => String(currentYear + 1 - index))
const demoMakes = ['AUDI', 'BMW', 'HONDA']
const demoModels = {
  AUDI: ['A4'],
  BMW: ['320i', '330e', '330i', '340i', '530i', '540i'],
  HONDA: ['Accord', 'Accord Hybrid'],
}

function displayMake(make) {
  if (make === 'BMW') return make
  if (make === make.toUpperCase()) return make.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())
  return make
}

function VehiclePicker({
  year,
  endYear,
  make,
  model,
  onYearChange,
  onEndYearChange,
  onMakeChange,
  onModelChange,
  onError,
  disabled = false,
}) {
  const [makeCatalog, setMakeCatalog] = useState([])
  const [makesLoaded, setMakesLoaded] = useState(!supabase)
  const [modelCatalog, setModelCatalog] = useState({ key: '', options: [] })
  const makes = supabase ? makeCatalog : demoMakes
  const modelKey = `${year}:${make}`
  const models = supabase
    ? modelCatalog.key === modelKey ? modelCatalog.options : []
    : demoModels[make] ?? []
  const loadingMakes = supabase && !makesLoaded
  const loadingModels = Boolean(supabase && make && modelCatalog.key !== modelKey)
  const endYears = years.filter((option) => Number(option) >= Number(year)
    && Number(option) <= Number(year) + 15)

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    supabase.functions.invoke('vehicle-research', { body: { action: 'makes' } }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        onError(`Could not load vehicle makes: ${error.message}`)
        setMakeCatalog([])
        setMakesLoaded(true)
        return
      }
      if (!Array.isArray(data?.options) || data.options.some((option) => typeof option !== 'string')) {
        onError('The vehicle catalog returned an unexpected make list.')
        setMakeCatalog([])
        setMakesLoaded(true)
        return
      }
      setMakeCatalog(data.options)
      setMakesLoaded(true)
    }).catch((error) => {
      if (active) {
        onError(`Could not load vehicle makes: ${error.message}`)
        setMakeCatalog([])
        setMakesLoaded(true)
      }
    })

    return () => { active = false }
  }, [onError])

  useEffect(() => {
    if (!supabase || !year || !make) return undefined

    let active = true
    supabase.functions.invoke('vehicle-research', {
      body: { action: 'models', make, year: Number(year) },
    }).then(({ data, error }) => {
      if (!active) return
      if (error) {
        onError(`Could not load ${make} models for ${year}: ${error.message}`)
        setModelCatalog({ key: modelKey, options: [] })
        return
      }
      if (!Array.isArray(data?.options) || data.options.some((option) => typeof option !== 'string')) {
        onError('The vehicle catalog returned an unexpected model list.')
        setModelCatalog({ key: modelKey, options: [] })
        return
      }
      setModelCatalog({ key: modelKey, options: data.options })
      onModelChange((current) => data.options.includes(current) ? current : '')
    }).catch((error) => {
      if (active) {
        onError(`Could not load ${make} models for ${year}: ${error.message}`)
        setModelCatalog({ key: modelKey, options: [] })
      }
    })

    return () => { active = false }
  }, [year, make, modelKey, onModelChange, onError])

  return (
    <div className="vehicle-picker">
      <label className="vehicle-select">
        <span>From</span>
        <select
          aria-label="Year"
          required
          value={year}
          disabled={disabled}
          onChange={(event) => {
            onYearChange(event.target.value)
            onModelChange('')
          }}
        >
          <option value="" disabled>Select year</option>
          {years.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="vehicle-select">
        <span>Through (optional)</span>
        <select
          aria-label="End year (optional)"
          value={endYear}
          disabled={disabled || !year}
          onChange={(event) => onEndYearChange(event.target.value)}
        >
          <option value="">Same year</option>
          {endYears.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="vehicle-select">
        <span>Make</span>
        <select
          aria-label="Make"
          required
          value={make}
          disabled={disabled || !year || loadingMakes || makes.length === 0}
          onChange={(event) => {
            onMakeChange(event.target.value)
            onModelChange('')
          }}
        >
          <option value="" disabled>{loadingMakes ? 'Loading makes…' : 'Select make'}</option>
          {makes.map((option) => <option key={option} value={option}>{displayMake(option)}</option>)}
        </select>
      </label>
      <label className="vehicle-select">
        <span>Model</span>
        <select
          aria-label="Model"
          required
          value={model}
          disabled={disabled || !year || !make || loadingModels || models.length === 0}
          onChange={(event) => onModelChange(event.target.value)}
        >
          <option value="" disabled>
            {loadingModels ? 'Loading models…' : !make ? 'Select make first' : models.length ? 'Select model' : 'No models for this year'}
          </option>
          {models.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  )
}

export default VehiclePicker
