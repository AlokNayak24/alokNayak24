#!/usr/bin/env node
// Renders a daily-contributions area chart from GitHub's own API, so the
// README doesn't depend on the third-party activity-graph service.

import fs from "node:fs"

const TOKEN = process.env.GH_TOKEN
const USER = process.env.GH_USER
const DAYS = 31

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

async function fetchRecentDays(login, days) {
  const now = new Date()
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  from.setUTCHours(0, 0, 0, 0)

  const data = await graphql(CALENDAR_QUERY, { login, from: from.toISOString(), to: now.toISOString() })
  const calendar = data.user.contributionsCollection.contributionCalendar

  const allDays = []
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      allDays.push({ date: day.date, count: day.contributionCount })
    }
  }
  allDays.sort((a, b) => a.date.localeCompare(b.date))

  return allDays.slice(-days)
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

function renderSVG(days) {
  const width = 900
  const height = 320
  const padL = 45
  const padR = 25
  const padT = 60
  const padB = 45
  const chartW = width - padL - padR
  const chartH = height - padT - padB

  const total = days.reduce((sum, d) => sum + d.count, 0)
  const maxCount = Math.max(1, ...days.map(d => d.count))

  const points = days.map((d, i) => {
    const x = padL + (days.length === 1 ? 0 : (i * chartW) / (days.length - 1))
    const y = padT + chartH - (d.count / maxCount) * chartH
    return { x, y, ...d }
  })

  const linePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} ` +
    points.slice(1).map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(padT + chartH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + chartH).toFixed(1)} Z`

  const gridLines = [0, 0.5, 1].map(f => {
    const y = padT + chartH - f * chartH
    const label = Math.round(f * maxCount)
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#2a2b3a" stroke-width="1"/>
    <text x="${padL - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis">${label}</text>`
  }).join("")

  const labelEvery = Math.ceil(days.length / 6)
  const xLabels = points.filter((_, i) => i % labelEvery === 0 || i === points.length - 1)
    .map(p => `<text x="${p.x.toFixed(1)}" y="${height - padB + 20}" text-anchor="middle" class="axis">${formatDate(p.date)}</text>`)
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="areaFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#70a5fd" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#70a5fd" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="agBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#70a5fd"/>
      <stop offset="50%" stop-color="#bf91f3"/>
      <stop offset="100%" stop-color="#38bdae"/>
    </linearGradient>
  </defs>
  <style>
    .title { font: 700 18px 'Segoe UI', Ubuntu, sans-serif; fill: #70a5fd; }
    .subtitle { font: 400 13px 'Segoe UI', Ubuntu, sans-serif; fill: #38bdae; }
    .axis { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: #9aa4b2; }
  </style>
  <rect fill="#1a1b27" x="1" y="1" width="${width - 2}" height="${height - 2}" rx="8" stroke="url(#agBorder)" stroke-width="1.5"/>
  <text x="${padL}" y="30" class="title">Contribution Activity</text>
  <text x="${padL}" y="48" class="subtitle">${total} contribution${total === 1 ? "" : "s"} in the last ${days.length} days</text>
  ${gridLines}
  <path d="${areaPath}" fill="url(#areaFill)"/>
  <path d="${linePath}" fill="none" stroke="#70a5fd" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${xLabels}
</svg>
`
}

async function main() {
  const days = await fetchRecentDays(USER, DAYS)
  const svg = renderSVG(days)
  fs.writeFileSync("github-activity-graph.svg", svg)
  const total = days.reduce((sum, d) => sum + d.count, 0)
  console.log(`Last ${DAYS} days: ${total} contributions`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
