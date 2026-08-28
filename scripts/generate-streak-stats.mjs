#!/usr/bin/env node
// Computes real contribution/streak data from GitHub's own API and renders it
// as a static SVG, so the README doesn't depend on any third-party service.

import fs from "node:fs"

const TOKEN = process.env.GH_TOKEN
const USER = process.env.GH_USER

if (!TOKEN || !USER) {
  console.error("Missing GH_TOKEN or GH_USER environment variable")
  process.exit(1)
}

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`GraphQL request failed (HTTP ${res.status}): ${JSON.stringify(json)}`)
  }
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors))
  }
  if (!json.data) {
    throw new Error(`GraphQL response had no data: ${JSON.stringify(json)}`)
  }
  return json.data
}

async function getUserCreatedAt(login) {
  const res = await fetch(`https://api.github.com/users/${login}`, {
    headers: {
      "Authorization": `bearer ${TOKEN}`,
      "Accept": "application/vnd.github+json",
    },
  })
  const json = await res.json()
  if (!res.ok || !json.created_at) {
    throw new Error(`Failed to fetch user ${login} (HTTP ${res.status}): ${JSON.stringify(json)}`)
  }
  return new Date(json.created_at)
}

const CALENDAR_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`

async function fetchAllDays(login) {
  const createdAt = await getUserCreatedAt(login)
  const startYear = createdAt.getUTCFullYear()
  const now = new Date()
  const currentYear = now.getUTCFullYear()

  const days = []
  let totalContributions = 0

  for (let year = startYear; year <= currentYear; year++) {
    const from = new Date(Date.UTC(year, 0, 1)).toISOString()
    const yearEnd = year === currentYear ? now : new Date(Date.UTC(year, 11, 31, 23, 59, 59))
    const to = yearEnd.toISOString()

    const data = await graphql(CALENDAR_QUERY, { login, from, to })
    const calendar = data.user.contributionsCollection.contributionCalendar
    totalContributions += calendar.totalContributions
    for (const week of calendar.weeks) {
      for (const day of week.contributionDays) {
        days.push({ date: day.date, count: day.contributionCount })
      }
    }
  }

  days.sort((a, b) => a.date.localeCompare(b.date))
  return { days, totalContributions, joinYear: startYear }
}

function computeStreaks(days) {
  let longest = 0, longestStart = null, longestEnd = null
  let run = 0, runStart = null

  for (const day of days) {
    if (day.count > 0) {
      if (run === 0) runStart = day.date
      run++
      if (run > longest) {
        longest = run
        longestStart = runStart
        longestEnd = day.date
      }
    } else {
      run = 0
    }
  }

  let current = 0, currentStart = null, currentEnd = null
  let idx = days.length - 1

  // Today isn't over yet, so a zero-contribution "today" doesn't break the streak
  if (idx >= 0 && days[idx].count === 0) idx--

  while (idx >= 0 && days[idx].count > 0) {
    if (current === 0) currentEnd = days[idx].date
    currentStart = days[idx].date
    current++
    idx--
  }

  return { longest, longestStart, longestEnd, current, currentStart, currentEnd }
}

function formatDate(dateStr) {
  if (!dateStr) return ""
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function formatRange(start, end) {
  if (!start) return "No streak yet"
  if (start === end) return formatDate(start)
  return `${formatDate(start)} - ${formatDate(end)}`
}

function renderSVG({ totalContributions, streaks, joinYear }) {
  const { longest, longestStart, longestEnd, current, currentStart, currentEnd } = streaks
  const totalRange = `${joinYear} - Present`
  const currentRange = current > 0 ? formatRange(currentStart, currentEnd) : "No streak yet"
  const longestRange = longest > 0 ? formatRange(longestStart, longestEnd) : "No streak yet"

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 495 195" width="495" height="195">
  <defs>
    <linearGradient id="borderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#70a5fd"/>
      <stop offset="50%" stop-color="#bf91f3"/>
      <stop offset="100%" stop-color="#38bdae"/>
    </linearGradient>
  </defs>
  <style>
    .num { font: 700 28px 'Segoe UI', Ubuntu, sans-serif; }
    .label { font: 700 14px 'Segoe UI', Ubuntu, sans-serif; fill: #70a5fd; }
    .range { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: #38bdae; }
    .divider { stroke: #333; stroke-width: 1; }
    .icon { fill: none; stroke: #70a5fd; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
  </style>
  <rect fill="#1a1b27" x="1" y="1" width="493" height="193" rx="8" stroke="url(#borderGradient)" stroke-width="1.5"/>
  <line class="divider" x1="165" y1="28" x2="165" y2="170"/>
  <line class="divider" x1="330" y1="28" x2="330" y2="170"/>

  <!-- Total Contributions -->
  <g transform="translate(74.5, 26)">
    <rect x="0" y="0" width="16" height="14" rx="2" class="icon"/>
    <line x1="0" y1="5" x2="16" y2="5" class="icon"/>
    <line x1="4" y1="-2" x2="4" y2="2" class="icon"/>
    <line x1="12" y1="-2" x2="12" y2="2" class="icon"/>
  </g>
  <text x="82.5" y="80" text-anchor="middle" class="num" fill="#70a5fd">${totalContributions}</text>
  <text x="82.5" y="116" text-anchor="middle" class="label">Total Contributions</text>
  <text x="82.5" y="146" text-anchor="middle" class="range">${totalRange}</text>

  <!-- Current Streak -->
  <circle cx="247.5" cy="71" r="40" fill="none" stroke="#70a5fd" stroke-width="5"/>
  <g transform="translate(247.5, 19.5)">
    <path fill="#bf91f3" d="M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 C 4.51 16.85 2.36 19 -0.29 19 Z"/>
  </g>
  <text x="247.5" y="80" text-anchor="middle" class="num" fill="#bf91f3">${current}</text>
  <text x="247.5" y="140" text-anchor="middle" class="label">Current Streak</text>
  <text x="247.5" y="166" text-anchor="middle" class="range">${currentRange}</text>

  <!-- Longest Streak -->
  <g transform="translate(404.5, 24)">
    <path d="M2 0h12v3a6 6 0 01-12 0V0z" class="icon"/>
    <path d="M2 1H-1a2 2 0 000 4h3" class="icon"/>
    <path d="M14 1h3a2 2 0 010 4h-3" class="icon"/>
    <line x1="8" y1="9" x2="8" y2="12" class="icon"/>
    <line x1="4" y1="13" x2="12" y2="13" class="icon"/>
  </g>
  <text x="412.5" y="80" text-anchor="middle" class="num" fill="#70a5fd">${longest}</text>
  <text x="412.5" y="116" text-anchor="middle" class="label">Longest Streak</text>
  <text x="412.5" y="146" text-anchor="middle" class="range">${longestRange}</text>
</svg>
`
}

async function main() {
  const { days, totalContributions, joinYear } = await fetchAllDays(USER)
  const streaks = computeStreaks(days)
  const svg = renderSVG({ totalContributions, streaks, joinYear })
  fs.writeFileSync("github-streak-stats.svg", svg)
  console.log(`Total: ${totalContributions}, Current streak: ${streaks.current}, Longest streak: ${streaks.longest}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
