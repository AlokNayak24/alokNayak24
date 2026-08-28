#!/usr/bin/env node
// Computes real GitHub stats (stars, commits, followers, repos, PRs, issues)
// and renders a ranked "trophy" showcase as a static SVG - no third-party
// service involved, same approach as generate-streak-stats.mjs.

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

const COMMITS_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
      }
    }
  }
`

async function fetchTotalCommits(login) {
  const createdAt = await getUserCreatedAt(login)
  const startYear = createdAt.getUTCFullYear()
  const now = new Date()
  const currentYear = now.getUTCFullYear()

  let totalCommits = 0
  for (let year = startYear; year <= currentYear; year++) {
    const from = new Date(Date.UTC(year, 0, 1)).toISOString()
    const yearEnd = year === currentYear ? now : new Date(Date.UTC(year, 11, 31, 23, 59, 59))
    const to = yearEnd.toISOString()

    const data = await graphql(COMMITS_QUERY, { login, from, to })
    totalCommits += data.user.contributionsCollection.totalCommitContributions
  }
  return totalCommits
}

const PROFILE_QUERY = `
  query($login: String!) {
    user(login: $login) {
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        totalCount
        nodes { stargazerCount }
      }
      pullRequests { totalCount }
      issues { totalCount }
    }
  }
`

async function fetchProfileStats(login) {
  const data = await graphql(PROFILE_QUERY, { login })
  const user = data.user
  const stars = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0)
  return {
    stars,
    followers: user.followers.totalCount,
    repositories: user.repositories.totalCount,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
  }
}

const TIERS = [
  { label: "C", color: "#6b7280" },
  { label: "B", color: "#38bdae" },
  { label: "A", color: "#70a5fd" },
  { label: "S", color: "#bf91f3" },
  { label: "SSS", color: "#ffd700" },
]

function rank(value, thresholds) {
  let idx = 0
  for (const t of thresholds) {
    if (value >= t) idx++
  }
  return TIERS[Math.min(idx, TIERS.length - 1)]
}

const TROPHIES = [
  { key: "stars", title: "Stars", thresholds: [1, 10, 50, 200] },
  { key: "commits", title: "Commits", thresholds: [10, 100, 500, 2000] },
  { key: "followers", title: "Followers", thresholds: [1, 10, 50, 200] },
  { key: "repositories", title: "Repositories", thresholds: [1, 10, 30, 60] },
  { key: "pullRequests", title: "Pull Requests", thresholds: [1, 5, 20, 50] },
  { key: "issues", title: "Issues", thresholds: [1, 5, 20, 50] },
]

function renderSVG(stats) {
  const cols = 3
  const gap = 15
  const cellW = 213
  const cellH = 167
  const width = cellW * cols + gap * (cols + 1)
  const rows = Math.ceil(TROPHIES.length / cols)
  const height = cellH * rows + gap * (rows + 1)

  const cells = TROPHIES.map((trophy, i) => {
    const value = stats[trophy.key]
    const tier = rank(value, trophy.thresholds)
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = gap + col * (cellW + gap)
    const y = gap + row * (cellH + gap)

    return `
  <g transform="translate(${x}, ${y})">
    <rect width="${cellW}" height="${cellH}" rx="10" fill="#1a1b27" stroke="${tier.color}" stroke-width="2"/>
    <g transform="translate(20, 16)" stroke="${tier.color}" class="icon">
      <path d="M2 0h12v3a6 6 0 01-12 0V0z"/>
      <path d="M2 1H-1a2 2 0 000 4h3"/>
      <path d="M14 1h3a2 2 0 010 4h-3"/>
      <line x1="8" y1="9" x2="8" y2="12"/>
      <line x1="4" y1="13" x2="12" y2="13"/>
    </g>
    <circle cx="${cellW - 30}" cy="30" r="17" fill="${tier.color}" opacity="0.15"/>
    <text x="${cellW - 30}" y="36" text-anchor="middle" class="rank" fill="${tier.color}">${tier.label}</text>
    <text x="${cellW / 2}" y="95" text-anchor="middle" class="num" fill="${tier.color}">${value}</text>
    <text x="${cellW / 2}" y="128" text-anchor="middle" class="label">${trophy.title}</text>
  </g>`
  }).join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <style>
    .num { font: 700 30px 'Segoe UI', Ubuntu, sans-serif; }
    .label { font: 700 13px 'Segoe UI', Ubuntu, sans-serif; fill: #9aa4b2; }
    .rank { font: 700 15px 'Segoe UI', Ubuntu, sans-serif; }
    .icon { fill: none; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  </style>
  <rect width="${width}" height="${height}" fill="none"/>${cells}
</svg>
`
}

async function main() {
  const [totalCommits, profileStats] = await Promise.all([
    fetchTotalCommits(USER),
    fetchProfileStats(USER),
  ])
  const stats = { ...profileStats, commits: totalCommits }
  const svg = renderSVG(stats)
  fs.writeFileSync("github-trophies.svg", svg)
  console.log(JSON.stringify(stats))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
