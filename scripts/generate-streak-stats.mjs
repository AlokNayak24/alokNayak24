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
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors))
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
  <style>
    .num { font: 700 28px 'Segoe UI', Ubuntu, sans-serif; }
    .label { font: 700 14px 'Segoe UI', Ubuntu, sans-serif; fill: #70a5fd; }
    .range { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: #38bdae; }
    .divider { stroke: #333; stroke-width: 1; }
  </style>
  <rect fill="#1a1b27" x="0.5" y="0.5" width="494" height="194" rx="4.5" stroke="#333"/>
  <line class="divider" x1="165" y1="28" x2="165" y2="170"/>
  <line class="divider" x1="330" y1="28" x2="330" y2="170"/>

  <text x="82.5" y="80" text-anchor="middle" class="num" fill="#70a5fd">${totalContributions}</text>
  <text x="82.5" y="116" text-anchor="middle" class="label">Total Contributions</text>
  <text x="82.5" y="146" text-anchor="middle" class="range">${totalRange}</text>

  <circle cx="247.5" cy="71" r="40" fill="none" stroke="#70a5fd" stroke-width="5"/>
  <text x="247.5" y="80" text-anchor="middle" class="num" fill="#bf91f3">${current}</text>
  <text x="247.5" y="140" text-anchor="middle" class="label">Current Streak</text>
  <text x="247.5" y="166" text-anchor="middle" class="range">${currentRange}</text>

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
