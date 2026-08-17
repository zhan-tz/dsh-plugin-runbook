/** Host half: serve produced files (images, text/code, pdf), run LLM turn explanations, and re-run scripts. */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'

export const name = 'dsh-plugin-runbook'
export const inject = ['fs', 'webServer']

const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }
const TEXT = new Set(['tex', 'txt', 'md', 'markdown', 'py', 'csv', 'json', 'parquet', 'npz', 'npy', 'pkl', 'h5', 'root', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'html', 'htm', 'css', 'scss', 'less', 'sh', 'bash', 'zsh', 'r', 'ipynb', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'c', 'cpp', 'h', 'hpp', 'rs', 'go', 'java', 'kt', 'sql', 'xml'])

// Runnable scripts: extension -> interpreter. Re-running these is the "Jupyter cell run" the
// runbook promises — it re-executes the script itself (deterministic), not the agent turn (LLM).
const RUNNERS = { py: 'python3', sh: 'bash', bash: 'bash', r: 'Rscript', js: 'node', mjs: 'node' }
const RUN_TIMEOUT_MS = 600000 // 10 minutes
const RUN_OUTPUT_CAP = 200000

async function readBody(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function runScript(interpreter, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let child
    try {
      child = spawn(interpreter, args, { cwd, env: process.env })
    } catch (error) {
      resolve({ exitCode: null, stdout, stderr, timedOut: false, error: String(error && error.message ? error.message : error) })
      return
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result) }
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > RUN_OUTPUT_CAP) stdout = stdout.slice(-RUN_OUTPUT_CAP) })
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > RUN_OUTPUT_CAP) stderr = stderr.slice(-RUN_OUTPUT_CAP) })
    child.on('error', (e) => finish({ exitCode: null, stdout, stderr, timedOut, error: String(e && e.message ? e.message : e) }))
    child.on('close', (code, signal) => finish({ exitCode: code === null ? null : code, signal: signal ?? null, stdout, stderr, timedOut }))
  })
}

export function apply(ctx) {
  const fs = ctx.get('fs')
  const webServer = ctx.get('webServer')
  if (fs === undefined || webServer === undefined) {
    console.error('dsh-plugin-runbook: fs or webServer unavailable; routes not registered')
    return
  }
  const MAX_BYTES = 26214400
  const fail = (res, code, message) => {
    if (res.headersSent) { res.end(); return }
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(message)
  }
  const failJson = (res, code, message) => {
    if (res.headersSent) { res.end(); return }
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: message }))
  }
  const queryParam = (rawUrl, key) => {
    const at = rawUrl.indexOf('?')
    if (at < 0) return ''
    for (const pair of rawUrl.slice(at + 1).split('&')) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      if (pair.slice(0, eq) === key) {
        try { return decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, '%20')) } catch { return '' }
      }
    }
    return ''
  }
  const dispose = webServer.register({
    kind: 'exact',
    path: '/agent-fileview',
    handler: async (req, res) => {
      try {
        const path = queryParam(req.url, 'path')
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
        if (!path.startsWith('/') || (!IMAGE[ext] && !TEXT.has(ext) && ext !== 'pdf')) {
          fail(res, 403, 'agent-fileview: unsupported path or file type')
          return
        }
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        if (info === undefined) { fail(res, 404, 'agent-fileview: not found: ' + path); return }
        if (typeof info.size === 'number' && info.size > MAX_BYTES) { fail(res, 413, 'agent-fileview: file larger than 25MB'); return }
        // Weak Etag (size+mtime) so history refreshes revalidate to 304s instead of re-downloading files.
        const mtime = typeof info.mtimeMs === 'number' ? info.mtimeMs : String(info.mtime ?? '0')
        const etag = 'W/"runbook-' + String(info.size) + '-' + mtime + '"'
        if (req.headers && req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=3600' })
          res.end()
          return
        }
        const bytes = await fs.readBytes(target, undefined, MAX_BYTES)
        if (res.headersSent) return
        let contentType
        let body = bytes
        if (IMAGE[ext]) contentType = IMAGE[ext]
        else if (ext === 'pdf') contentType = 'application/pdf'
        else { contentType = 'text/plain; charset=utf-8'; body = new TextDecoder().decode(bytes) }
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length), 'Cache-Control': 'private, max-age=3600', 'ETag': etag })
        res.end(body)
      } catch (error) {
        fail(res, 500, 'agent-fileview error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => dispose, 'dsh-plugin-runbook: web route')

  // ---- Script re-run route (the "Jupyter cell run": execute a produced script) ----
  const disposeRun = webServer.register({
    kind: 'exact',
    path: '/agent-run',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { failJson(res, 405, 'agent-run: POST only'); return }
        const raw = await readBody(req, 65536)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-run: invalid JSON'); return }
        const path = payload && typeof payload.path === 'string' ? payload.path : ''
        const cwd = payload && typeof payload.cwd === 'string' && payload.cwd.length > 0 ? payload.cwd : ''
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
        const interpreter = RUNNERS[ext]
        if (!path.startsWith('/') || interpreter === undefined) { failJson(res, 403, 'agent-run: not a runnable absolute script path'); return }
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        if (info === undefined) { failJson(res, 404, 'agent-run: script not found: ' + path); return }
        const runCwd = cwd.startsWith('/') ? cwd : dirname(path)
        const result = await runScript(interpreter, [path], runCwd, RUN_TIMEOUT_MS)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify(result))
      } catch (error) {
        failJson(res, 500, 'agent-run error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposeRun, 'dsh-plugin-runbook: run route')

  // ---- Git history route (the "main program" the conversation never mentions) ----
  // Conversation scraping only sees files echoed in tool output; pre-existing code,
  // other sessions' work and tool-generated files stay invisible. `git log` +
  // `git status` are the durable ledger of what changed and when.
  const GIT_TIMEOUT_MS = 8000
  const parseGitPath = (raw) => {
    let p = raw
    const arrow = p.indexOf(' -> ') // rename entries: "old -> new" — the new path is what exists now
    if (arrow >= 0) p = p.slice(arrow + 4)
    return p.replace(/^"|"$/g, '')
  }
  const disposeGit = webServer.register({
    kind: 'exact',
    path: '/agent-git',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { failJson(res, 405, 'agent-git: POST only'); return }
        const raw = await readBody(req, 65536)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-git: invalid JSON'); return }
        const cwd = payload && typeof payload.cwd === 'string' && payload.cwd.startsWith('/') ? payload.cwd : ''
        if (cwd === '') { failJson(res, 403, 'agent-git: absolute cwd required'); return }
        // Project root = git TOPLEVEL, not the probed dir: clients probe any
        // subdirectory they saw a file in; aiming them back at the repo root is
        // what makes scan/PIPELINE.md discovery work from any entry point.
        const top = await runScript('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], '', GIT_TIMEOUT_MS)
        const root = typeof top.stdout === 'string' && top.stdout.trim().startsWith('/') ? top.stdout.trim() : cwd
        const [log, status] = await Promise.all([
          runScript('git', ['-C', root, 'log', '-n', '60', '--name-status', '--pretty=format:%H%x1f%at%x1f%s'], '', GIT_TIMEOUT_MS),
          runScript('git', ['-C', root, 'status', '--porcelain'], '', GIT_TIMEOUT_MS),
        ])
        if (res.headersSent) return
        // runScript omits `error` on clean exits (undefined), so normalize before testing.
        const logErr = typeof log.error === 'string' && log.error !== '' ? log.error : ''
        const notRepo = (r) => (r.exitCode === 128) || /not a git repository/i.test(r.stderr)
        if (logErr !== '' || notRepo(log)) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, notRepo: notRepo(log), error: logErr || log.stderr.slice(0, 200) }))
          return
        }
        const commits = []
        let totalFiles = 0
        for (const block of log.stdout.split(/\n\n+/)) {
          const lines = block.split('\n').filter((l) => l.length > 0)
          if (lines.length === 0) continue
          const meta = lines[0].split('\x1f')
          if (meta.length < 3) continue
          const files = []
          for (let i = 1; i < lines.length && totalFiles < 600; i++) {
            const m = lines[i].match(/^([A-Z?]+)\t(.*)$/)
            if (m === null) continue
            const p = parseGitPath(m[2])
            if (p === '' || p.startsWith('node_modules/') || p.includes('/.git/')) continue
            // Keep the change status (A added / M modified / D deleted): the graph
            // styles committed files by how they entered the repo.
            files.push({ p, s: m[1].charAt(0) })
            totalFiles++
          }
          commits.push({ hash: meta[0], at: Number(meta[1]) || 0, subject: meta[2].slice(0, 120), files })
        }
        const dirty = []
        for (const line of status.stdout.split('\n')) {
          if (line.length < 4) continue
          const p = parseGitPath(line.slice(3))
          if (p === '' || p.startsWith('node_modules/') || p.includes('/.git/')) continue
          if (dirty.length < 200) dirty.push(p)
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, cwd: root, commits, dirty }))
      } catch (error) {
        failJson(res, 500, 'agent-git error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposeGit, 'dsh-plugin-runbook: git route')

  // ---- Subagent runs route (cross-session handoff edges) ----
  // A child agent's script runs and file edits live in ITS session log, invisible
  // to the parent conversation's accumulator. This route mines child logs for
  // runs/edits/reads + the task prompt's input paths, so the runbook can draw
  // agent -> script -> artifact edges across session boundaries.
  const SUB_PATH_RE = /(?:\/Users|\/home|\/tmp)\/[A-Za-z0-9_@%+=:./~-]*?\.(?:png|jpg|jpeg|webp|gif|svg|tex|txt|md|markdown|py|csv|json|js|mjs|cjs|ts|tsx|jsx|html|htm|css|scss|less|sh|bash|zsh|r|ipynb|yml|yaml|toml|ini|cfg|c|cpp|h|hpp|rs|go|java|kt|sql|xml|pdf)(?![A-Za-z0-9])/g
  const SCRIPT_EXT = new Set(['py', 'r', 'sh', 'bash', 'js', 'mjs'])
  const parseSubCommand = (raw) => {
    if (typeof raw !== 'string' || raw.length === 0) return null
    let cmd = ''
    try { const o = JSON.parse(raw); if (o !== null && typeof o === 'object' && typeof o.command === 'string') cmd = o.command } catch { return null }
    if (cmd === '') return null
    const paths = cmd.match(SUB_PATH_RE) || []
    let script = null
    const inputs = []
    for (const raw2 of paths) {
      const p = raw2.replace(/[.,;:]+$/, '')
      const e = p.slice(p.lastIndexOf('.') + 1).toLowerCase()
      if (script === null && SCRIPT_EXT.has(e)) script = p
      else inputs.push(p)
    }
    return script === null ? null : { script, inputs }
  }
  const subTextOf = (message) => {
    let text = ''
    const content = message !== null && typeof message === 'object' && Array.isArray(message.content) ? message.content : []
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (typeof block.text === 'string') text += '\n' + block.text
      if (Array.isArray(block.content)) for (const inner of block.content) if (inner !== null && typeof inner === 'object' && typeof inner.text === 'string') text += '\n' + inner.text
      if (text.length > 200000) break
    }
    return text
  }
  const disposeSubruns = webServer.register({
    kind: 'exact',
    path: '/agent-subruns',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { failJson(res, 405, 'agent-subruns: POST only'); return }
        const raw = await readBody(req, 65536)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-subruns: invalid JSON'); return }
        let ids = payload !== null && typeof payload === 'object' && Array.isArray(payload.ids) ? payload.ids.filter((x) => typeof x === 'string').slice(0, 12) : []
        const parentSessionId = payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
        // Self-discovery: the GUI session list never includes subagent rows, so a
        // parent that DID spawn children (background/durable agents) looks childless.
        // The parent's own log carries the evidence — `agent/inbox/spliced` events
        // mention "Background subagent <uuid>". Harvest ids that really exist on
        // disk and merge them with the explicitly passed ones.
        if (ids.length === 0 && parentSessionId.length > 0) {
          try {
            let proots = []
            try { proots = readdirSync(join(home, 'sessions')) } catch { proots = [] }
            for (const key of proots) {
              for (const suffix of ['session-' + parentSessionId, parentSessionId]) {
                const pfile = join(home, 'sessions', key, suffix, 'session.jsonl.zstd')
                try { statSync(pfile) } catch { continue }
                const pr = await runScript('zstd', ['-dc', pfile], '', 8000)
                const ptext = pr.stdout || ''
                const seen = new Set()
                // Only ids explicitly introduced as spawned agents ("Background
                // subagent <uuid>") — a bare uuid grep would swallow every session
                // id merely MENTIONED in the conversation.
                for (const m of ptext.matchAll(/subagent ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g)) {
                  if (m[1] === parentSessionId || seen.has(m[1])) continue
                  seen.add(m[1])
                }
                // keep only ids that exist as session dirs (bare or prefixed)
                let pentries = []
                try { pentries = readdirSync(join(home, 'sessions', key)) } catch { pentries = [] }
                const dirBare = new Set(pentries.map((n) => (n.startsWith('session-') ? n.slice('session-'.length) : n)))
                for (const id of seen) if (dirBare.has(id) && id !== parentSessionId) ids.push(id)
                ids = ids.slice(0, 12)
                break
              }
              if (ids.length > 0) break
            }
          } catch {}
        }
        if (ids.length === 0) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, sessions: [] })); return }
        // Session dirs are cwd-keyed: ~/.dsh/sessions/<key>/<id or session-id>/
        let roots = []
        try { roots = readdirSync(join(home, 'sessions')) } catch { roots = [] }
        const byId = new Map()
        for (const key of roots) {
          let entries = []
          try { entries = readdirSync(join(home, 'sessions', key)) } catch { continue }
          for (const name of entries) {
            const bare = name.startsWith('session-') ? name.slice('session-'.length) : name
            if (ids.includes(bare)) byId.set(bare, join(home, 'sessions', key, name, 'session.jsonl.zstd'))
          }
        }
        const sessions = []
        for (const id of ids) {
          const file = byId.get(id)
          if (file === undefined) continue
          const zr = await runScript('zstd', ['-dc', file], '', 8000)
          if (zr.error !== '' && zr.error !== undefined) continue
          if (typeof zr.exitCode === 'number' && zr.exitCode !== 0) continue
          let label = ''
          const runs = []
          const edits = []
          const reads = []
          const taskInputs = []
          const pendingBash = {}
          const seenOut = new Set()
          for (const line of zr.stdout.split('\n')) {
            if (line.length === 0) continue
            let ev
            try { ev = JSON.parse(line) } catch { continue }
            const type = ev.type
            const d = ev.data
            if (type === 'subagent/descriptor' && d !== null && typeof d === 'object' && typeof d.label === 'string') label = d.label.slice(0, 40)
            else if (type === 'agent/inbox/spliced' && d !== null && typeof d === 'object' && Array.isArray(d.inserted) && taskInputs.length === 0) {
              let text = ''
              for (const ins of d.inserted.slice(0, 2)) {
                if (ins === null || typeof ins !== 'object' || !Array.isArray(ins.content)) continue
                for (const c of ins.content) if (c !== null && typeof c === 'object' && typeof c.text === 'string') text += '\n' + c.text
              }
              for (const m of (text.match(SUB_PATH_RE) || [])) { const p = m.replace(/[.,;:]+$/, ''); if (!taskInputs.includes(p) && taskInputs.length < 12) taskInputs.push(p) }
            } else if (type === 'tool/call' && d !== null && typeof d === 'object') {
              const tool = typeof d.name === 'string' ? d.name : ''
              if (tool === 'bash' && typeof d.callId === 'string') {
                const r = parseSubCommand(d.arguments)
                if (r !== null) pendingBash[d.callId] = r
              } else if (tool === 'read' && typeof d.arguments === 'string') {
                try { const o = JSON.parse(d.arguments); if (o !== null && typeof o === 'object' && typeof o.file_path === 'string' && reads.length < 40) reads.push(o.file_path) } catch {}
              } else if ((tool === 'write' || tool === 'edit') && typeof d.arguments === 'string') {
                try {
                  const o = JSON.parse(d.arguments)
                  if (o !== null && typeof o === 'object' && typeof o.file_path === 'string') {
                    // Refs = bare filenames referenced in the script's own code (e.g. the
                    // csv/json it opens), resolved against the script's directory — the
                    // reliable way to spot a child script's real inputs.
                    const refs = []
                    const content = typeof o.content === 'string' ? o.content.slice(0, 100000) : (typeof o.new_string === 'string' ? o.new_string : '')
                    const dir = dirname(o.file_path)
                    const seenRef = new Set()
                    for (const m of (content.match(/\b[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:png|jpg|jpeg|webp|gif|svg|csv|json|md|markdown|txt|tex|ya?ml|toml|tsv|dat|h5|hdf5|pkl|npy|npz|parquet)\b/g) || [])) {
                      const p = dir + '/' + m
                      if (!seenRef.has(p) && refs.length < 10) { seenRef.add(p); refs.push(p) }
                    }
                    if (!edits.some((e) => e.path === o.file_path) && edits.length < 30) edits.push({ path: o.file_path, refs })
                  }
                } catch {}
              }
            } else if (type === 'tool/result' && d !== null && typeof d === 'object') {
              const message = d.message
              const callId = message !== null && typeof message === 'object' && message.source !== null && typeof message.source === 'object' ? message.source.callId : undefined
              if (typeof callId !== 'string' || pendingBash[callId] === undefined) continue
              const text = subTextOf(message)
              const outputs = []
              for (const m of (text.match(SUB_PATH_RE) || [])) {
                const p = m.replace(/[.,;:]+$/, '')
                if (!seenOut.has(p) && !outputs.includes(p) && outputs.length < 20) { seenOut.add(p); outputs.push(p) }
              }
              if (runs.length < 40) runs.push({ script: pendingBash[callId].script, inputs: pendingBash[callId].inputs, outputs })
              delete pendingBash[callId]
            }
          }
          sessions.push({ id, label, runs, edits, reads, taskInputs })
        }
        if (res.headersSent) return
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, sessions }))
      } catch (error) {
        failJson(res, 500, 'agent-subruns error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposeSubruns, 'dsh-plugin-runbook: subruns route')

  // ---- Persistent change ledger (survives compaction / reloads) ----
  // The client accumulator's runs/edits die with paged-out turn data (compaction
  // collapsed a whole session into one turn once and every edge vanished). This
  // ledger is the durable backbone: append every captured run/edit once, read it
  // back per workspace on open. JSONL at ~/.dsh/dsh-plugin-runbook/ledger.jsonl.
  const ledgerDir = join(homedir(), '.dsh', 'dsh-plugin-runbook')
  const ledgerFile = join(ledgerDir, 'ledger.jsonl')
  const LEDGER_MAX = 2000
  const readLedger = () => {
    try {
      mkdirSync(ledgerDir, { recursive: true })
      return readFileSync(ledgerFile, 'utf8')
    } catch { return '' }
  }
  const disposeLedger = webServer.register({
    kind: 'exact',
    path: '/agent-ledger',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const dir = queryParam(req.url, 'dir')
          const text = readLedger()
          const entries = []
          for (const line of text.split('\n')) {
            if (line.length === 0 || entries.length >= 400) continue
            let e
            try { e = JSON.parse(line) } catch { continue }
            if (dir.length > 0 && typeof e.script === 'string' && !e.script.startsWith(dir + '/')) continue
            entries.push(e)
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: true, entries }))
          return
        }
        if (req.method !== 'POST') { failJson(res, 405, 'agent-ledger: GET/POST only'); return }
        const raw = await readBody(req, 262144)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-ledger: invalid JSON'); return }
        const entries = payload !== null && typeof payload === 'object' && Array.isArray(payload.entries) ? payload.entries.slice(0, 100) : []
        const sessionId = payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string' ? payload.sessionId : ''
        const cwd = payload !== null && typeof payload === 'object' && typeof payload.cwd === 'string' ? payload.cwd : ''
        if (entries.length === 0) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end('{"ok":true}'); return }
        const known = new Set()
        for (const line of readLedger().split('\n')) {
          if (line.length === 0) continue
          try { known.add(JSON.parse(line).k) } catch {}
        }
        const lines = []
        for (const e of entries) {
          if (e === null || typeof e !== 'object') continue
          const kind = e.kind === 'run' ? 'run' : e.kind === 'edit' ? 'edit' : ''
          if (kind === '') continue
          const k = kind + ':' + (kind === 'run' ? String(e.script) + '>' + (Array.isArray(e.outputs) ? e.outputs.join(',') : '') : String(e.path))
          if (known.has(k)) continue
          known.add(k)
          lines.push(JSON.stringify({ k, ts: Date.now(), sessionId, cwd, ...e }))
        }
        if (lines.length > 0) {
          const old = readLedger().split('\n').filter((l) => l.length > 0)
          const next = old.concat(lines).slice(-LEDGER_MAX).join('\n') + '\n'
          mkdirSync(ledgerDir, { recursive: true })
          writeFileSync(ledgerFile, next, 'utf8')
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
      } catch (error) {
        failJson(res, 500, 'agent-ledger error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposeLedger, 'dsh-plugin-runbook: ledger route')

  // ---- Workspace scan (files never run / committed / logged are still real) ----
  // The graph used to know only what the session recorded, git committed, or a
  // child log held — research code that was only written (never run via captured
  // absolute paths, never pushed) was invisible. This route walks the actual
  // directory tree and statically parses each script's I/O calls, so the pipeline
  // can be INFERRED from the files themselves. No session data required.
  const SCAN_EXTS = new Set(['py', 'r', 'sh', 'bash', 'js', 'mjs', 'csv', 'tsv', 'json', 'md', 'markdown', 'txt', 'tex', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'pdf', 'yml', 'yaml', 'toml', 'ipynb', 'pkl', 'npy', 'npz', 'h5', 'parquet', 'dat', 'ts', 'go', 'rs', 'java', 'cpp', 'c', 'sql'])
  const SCAN_SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.DS_Store', 'archive', '.next', 'dist', 'build', '.cache'])
  const READ_CALLS = /(?:read_csv|read_excel|read_json|read_table|read_parquet|read_fwf|imread|imsave|np\.load|torch\.load|joblib\.load|pickle\.load|Image\.open|cv2\.imread|open)\(\s*['"]([^'"]+)['"]/g
  const WRITE_CALLS = /(?:to_csv|to_excel|to_json|to_parquet|savefig|np\.save|torch\.save|joblib\.dump|pickle\.dump|write_csv|write_json|export_csv)\(\s*(?:[^,()]+,\s*)?['"]([^'"]+)['"]/g
  const WRITE_OPEN = /open\(\s*['"]([^'"]+)['"]\s*,\s*['"][wa]/g
  const refBasenameOk = (name) => /^[A-Za-z0-9_][A-Za-z0-9_. -]*\.[A-Za-z0-9]{1,6}$/.test(name)
  const disposeScan = webServer.register({
    kind: 'exact',
    path: '/agent-scan',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { failJson(res, 405, 'agent-scan: POST only'); return }
        const raw = await readBody(req, 8192)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-scan: invalid JSON'); return }
        const dir = payload !== null && typeof payload === 'object' && typeof payload.dir === 'string' ? payload.dir.replace(/\/+$/, '') : ''
        if (dir.length === 0 || !existsSync(dir) || !statSync(dir).isDirectory()) { failJson(res, 400, 'agent-scan: dir required'); return }
        // Bounded walk: depth 5, 500 files, 25ms of stat budget per entry via size cap.
        const found = []
        const queue = [{ d: dir, depth: 0 }]
        while (queue.length > 0 && found.length < 500) {
          const { d, depth } = queue.shift()
          if (depth > 5) continue
          let entries = []
          try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
          for (const ent of entries) {
            if (found.length >= 500) break
            if (SCAN_SKIP.has(ent.name)) continue
            const full = d + '/' + ent.name
            if (ent.isDirectory()) { queue.push({ d: full, depth: depth + 1 }); continue }
            const dot = ent.name.lastIndexOf('.')
            if (dot < 0) continue
            if (!SCAN_EXTS.has(ent.name.slice(dot + 1).toLowerCase())) continue
            let st
            try { st = statSync(full) } catch { continue }
            if (st.size > 26214400) continue
            found.push({ abs: full, rel: full.slice(dir.length + 1), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) })
          }
        }
        // Static I/O analysis per script: refs count only when the target EXISTS in
        // the walked set — that precision is what makes the inferred edges honest.
        const exists = new Set(found.map((f) => f.abs))
        const mtimeOf = new Map(found.map((f) => [f.abs, f.mtime]))
        // Indirect IO (OUT_DIR = ...; fig.savefig(str(OUT/'fig.png'))) never
        // resolves against the script's own dir. A UNIQUE basename anywhere in
        // the walked workspace is an honest link target.
        const byBase = new Map()
        for (const f of found) {
          const b = f.abs.slice(f.abs.lastIndexOf('/') + 1)
          if (!byBase.has(b)) byBase.set(b, [])
          byBase.get(b).push(f.abs)
        }
        const resolveRef = (base, name) => {
          if (!refBasenameOk(name)) return ''
          if (name.startsWith('/')) return exists.has(name) ? name : ''
          const abs = base + '/' + name
          if (exists.has(abs)) return abs
          const hits = byBase.get(name)
          return hits !== undefined && hits.length === 1 ? hits[0] : ''
        }
        const scripts = []
        for (const f of found) {
          const ext = f.rel.slice(f.rel.lastIndexOf('.') + 1).toLowerCase()
          if (!SCRIPT_EXT.has(ext) || scripts.length >= 200 || f.size > 262144) continue
          let code = ''
          try { code = readFileSync(f.abs, 'utf8') } catch { continue }
          const base = f.abs.slice(0, f.abs.lastIndexOf('/'))
          const reads = []
          const writes = []
          const addRef = (arr, m) => {
            if (m[1] === undefined) return
            const abs = resolveRef(base, m[1])
            if (abs !== '' && !arr.includes(abs) && arr.length < 12) arr.push(abs)
          }
          for (const m of code.matchAll(READ_CALLS)) addRef(reads, m)
          for (const m of code.matchAll(WRITE_CALLS)) addRef(writes, m)
          for (const m of code.matchAll(WRITE_OPEN)) addRef(writes, m)
          // Fallback for indirect IO (`arg("--out", "data.csv")`,
          // `os.path.join(HERE, "x.csv")`). Three precision tiers:
          //   1. CLI flag adjacency: a filename right after "--out"/"-o"/"--output"
          //      is a write, after "--data"/"--input"/"-i" is a read — research
          //      scripts are full of this and it is exact.
          //   2. bare filename literals, direction by mtime (newer than script =
          //      artifact, older = input). Misfires when artifacts get re-run, so
          //      it only classifies literals tier 1 left alone.
          const known = new Set([...reads, ...writes])
          const FLAG_WRITE = /['"](?:-{1,2}o(?:ut(?:put|putfile|file)?)?|save|to)['"]\s*[,)]\s*['"]([^'"]+)['"]/g
          const FLAG_READ = /['"](?:-{1,2}(?:data(?:set|file)?|input|in|src|source)|i)['"]\s*[,)]\s*['"]([^'"]+)['"]/g
          const addLiteral = (arr, m) => {
            if (m[1] === undefined) return
            const abs = resolveRef(base, m[1])
            if (abs === '' || known.has(abs) || arr.includes(abs)) return
            known.add(abs)
            if (arr.length < 12) arr.push(abs)
          }
          for (const m of code.matchAll(FLAG_WRITE)) addLiteral(writes, m)
          for (const m of code.matchAll(FLAG_READ)) addLiteral(reads, m)
          const LITERAL = /['"]([A-Za-z0-9_][A-Za-z0-9_. -]*\.(?:csv|tsv|json|md|txt|tex|png|jpg|jpeg|webp|gif|svg|pkl|npy|npz|h5|parquet|dat|yaml|yml|toml))['"]/g
          for (const m of code.matchAll(LITERAL)) {
            if (m[1] === undefined) continue
            const abs = resolveRef(base, m[1])
            if (abs === '' || known.has(abs)) continue
            known.add(abs)
            if (f.mtime < (mtimeOf.get(abs) || 0) && writes.length < 12) writes.push(abs)
            else if (reads.length < 12) reads.push(abs)
          }
          if (reads.length > 0 || writes.length > 0) scripts.push({ path: f.abs, reads, writes })
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, dir, files: found.slice(0, 300), scripts }))
      } catch (error) {
        failJson(res, 500, 'agent-scan error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposeScan, 'dsh-plugin-runbook: scan route')

  // ---- Pipeline skeleton route (PIPELINE.md -> graph backbone) ----
  // Research projects often carry a hand-curated PIPELINE.md: mermaid DAG + a
  // status table, exactly the structure a human expects a "runbook" to show.
  // Session-event archaeology can never recover it — the doc IS the truth. This
  // route parses it into stage nodes (with status) + flow edges + the filenames
  // each stage mentions, so the client can hang real disk files off each stage.
  const STAGE_STATUS_ORDER = ['💀', '⚠️', '🔶', '✅']
  const disposePipeline = webServer.register({
    kind: 'exact',
    path: '/agent-pipeline',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { failJson(res, 405, 'agent-pipeline: POST only'); return }
        const raw = await readBody(req, 8192)
        let payload
        try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-pipeline: invalid JSON'); return }
        const dir = payload !== null && typeof payload === 'object' && typeof payload.dir === 'string' ? payload.dir.replace(/\/+$/, '') : ''
        if (dir.length === 0) { failJson(res, 400, 'agent-pipeline: dir required'); return }
        const file = join(dir, 'PIPELINE.md')
        let text = ''
        try { text = readFileSync(file, 'utf8') } catch {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: true, found: false }))
          return
        }
        if (text.length > 262144) text = text.slice(0, 262144)
        // Extract the FIRST mermaid block — that is the canonical main-chain DAG.
        const mm = text.match(/```mermaid\s*\n([\s\S]*?)```/)
        if (mm === null) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: true, found: false }))
          return
        }
        const nodes = new Map()
        const edges = []
        const NODE_FILE = /[A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:py|sh|bash|cpp|c|root|csv|tsv|json|npz|npy|pkl|h5|parquet|pdf|png|svg|md|txt)/g
        const addNode = (id, label) => {
          if (typeof id !== 'string' || id.length === 0) return
          const clean = (label !== undefined ? String(label) : '').replace(/<br\s*\/?>/g, ' ').replace(/["']/g, '').replace(/\s+/g, ' ').trim()
          let status = ''
          for (const st of STAGE_STATUS_ORDER) if (clean.includes(st)) { status = st; break }
          const files = [...clean.matchAll(NODE_FILE)].map((m) => m[0])
          const prev = nodes.get(id)
          if (prev === undefined) {
            nodes.set(id, { id, label: (clean.length > 0 ? clean : id).slice(0, 64), status, files: files.slice(0, 12) })
            return
          }
          // Bare references re-mention a stage: merge files/status in, but never
          // let an ID-only mention clobber the real label defined earlier.
          const merged = [...new Set([...prev.files, ...files])].slice(0, 12)
          nodes.set(id, {
            id,
            label: (clean.length > prev.label.length ? clean.slice(0, 64) : prev.label),
            status: prev.status !== '' ? prev.status : status,
            files: merged,
          })
        }
        for (const line of mm[1].split('\n')) {
          const t = line.trim()
          if (t.length === 0 || t.startsWith('%%') || t.startsWith('flowchart') || t.startsWith('graph')) continue
          // edges: A -->|label| B  |  A --> B  (either side may carry [label])
          const parts = t.split(/-->/)
          if (parts.length < 2) continue
          let edgeLabel = ''
          const cleaned = []
          for (const part of parts) {
            const lab = part.match(/\|([^|]*)\|/)
            if (lab !== null) edgeLabel = lab[1].trim().slice(0, 40)
            cleaned.push(part.replace(/\|[^|]*\|/g, ''))
          }
          const ids = []
          for (const part of cleaned) {
            const p = part.trim()
            const def = p.match(/^([A-Za-z0-9_]+)\s*[\[({]([\s\S]*)[\])}]/)
            if (def !== null) { addNode(def[1], def[2]); ids.push(def[1]); continue }
            const bare = p.match(/^([A-Za-z0-9_]+)$/)
            if (bare !== null) { addNode(bare[1], undefined); ids.push(bare[1]) }
          }
          for (let k = 1; k < ids.length; k++) {
            if (ids[k - 1] !== ids[k] && edges.length < 60) edges.push({ from: ids[k - 1], to: ids[k], label: k === 1 ? edgeLabel : '' })
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, found: true, dir, nodes: [...nodes.values()].slice(0, 40), edges }))
      } catch (error) {
        failJson(res, 500, 'agent-pipeline error: ' + (error && error.message ? error.message : String(error)))
      }
    },
  })
  ctx.effect(() => disposePipeline, 'dsh-plugin-runbook: pipeline route')

  // ---- LLM turn explanation route (single-cell "explain") ----
  // The browser half calls this with {provider, model, prompt}. The model route is
  // captured from the turn's assistant/message source by the client accumulator.
  const llm = ctx.get('llm')
  if (llm !== undefined) {
    const disposeExplain = webServer.register({
      kind: 'exact',
      path: '/agent-explain',
      handler: async (req, res) => {
        try {
          if (req.method !== 'POST') { failJson(res, 405, 'agent-explain: POST only'); return }
          const raw = await readBody(req, 131072)
          let payload
          try { payload = JSON.parse(raw) } catch { failJson(res, 400, 'agent-explain: invalid JSON'); return }
          const provider = payload && typeof payload.provider === 'string' ? payload.provider : ''
          const model = payload && typeof payload.model === 'string' ? payload.model : ''
          const prompt = payload && typeof payload.prompt === 'string' ? payload.prompt : ''
          const system = payload && typeof payload.system === 'string' ? payload.system : undefined
          const maxTokens = typeof payload.maxTokens === 'number' && payload.maxTokens > 0 ? Math.min(800, Math.floor(payload.maxTokens)) : 320
          if (provider === '' || model === '' || prompt === '') { failJson(res, 400, 'agent-explain: provider/model/prompt required'); return }
          const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: 'dsh-plugin-runbook' } }]
          let text = ''
          let finishError = ''
          for await (const chunk of llm.stream({ provider, model, messages, system, maxTokens, purpose: 'runbook-explain' })) {
            if (chunk === null || typeof chunk !== 'object') continue
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
            else if (chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
              const f = chunk.reason.failure
              finishError = f && (f.message || f.code) ? String(f.message || f.code) : String(chunk.reason.kind)
            }
          }
          if (res.headersSent) return
          if (finishError !== '') { failJson(res, 502, finishError); return }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ text }))
        } catch (error) {
          failJson(res, 500, 'agent-explain error: ' + (error && error.message ? error.message : String(error)))
        }
      },
    })
    ctx.effect(() => disposeExplain, 'dsh-plugin-runbook: explain route')
  }
}

export default { name, inject, apply }
