/** Client half: Jupyter-like runbook — one living file-flow DAG. Scrub turns, watch the pipeline grow, click any node to preview / run / explain. */
window.__ModuleLoader__.load({
	id: "dsh-plugin-runbook",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
		const TEXT_EXT = ["tex", "txt", "md", "markdown", "py", "csv", "json", "parquet", "npz", "npy", "pkl", "h5", "root", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "htm", "css", "scss", "less", "sh", "bash", "zsh", "r", "ipynb", "yml", "yaml", "toml", "ini", "cfg", "c", "cpp", "h", "hpp", "rs", "go", "java", "kt", "sql", "xml"];
		const ALL_EXT = IMAGE_EXT.concat(TEXT_EXT, ["pdf"]);
		const FILE_PATH_RE = new RegExp("(?:\\/Users|\\/home|\\/tmp)\\/[A-Za-z0-9_@%+=:./~-]*?\\.(?:" + ALL_EXT.join("|") + ")(?![A-Za-z0-9])", "g");
const REL_FILE_RE = new RegExp('(?:^|[\s"\'(=|:])([A-Za-z0-9_@%+=:./~-]+\.(?:' + ALL_EXT.join("|") + '))(?![A-Za-z0-9])', "g");

		const basename = (path) => {
			const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return at === -1 ? path : path.slice(at + 1);
		};
		const extOf = (path) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
		const fileUrl = (path) => "agent-fileview?path=" + encodeURIComponent(path);
		const kindOf = (path) => {
			const e = extOf(path);
			if (IMAGE_EXT.indexOf(e) >= 0) return "image";
			if (e === "pdf") return "pdf";
			if (TEXT_EXT.indexOf(e) >= 0) return "text";
			return "other";
		};
		const RUNNABLE_EXT = { py: 1, sh: 1, bash: 1, r: 1, js: 1, mjs: 1 };
		const isRunnable = (path) => RUNNABLE_EXT[extOf(path)] === 1;
		const EXT_SET = new Set(ALL_EXT.map((e) => e.toLowerCase()));
		// A path we are willing to show as a node, checked on a single explicit string
		// (write/edit file_path) instead of scanning text with the global regex.
		const isCapturedPath = (p) => typeof p === "string" && p.length > 0
			&& (p.startsWith("/Users/") || p.startsWith("/home/") || p.startsWith("/tmp/"))
			&& EXT_SET.has(extOf(p));
		// Session cwd, refreshed by RunbookView on every render. Tool events carry
		// RELATIVE paths ("research/mdc/...") resolved against the shell cwd —
		// without joining them here, every such file fails isCapturedPath and the
		// whole session's produce/consume edges silently vanish from the graph.
		var knownCwd = "";
		const normPath = (p) => {
			if (typeof p !== "string" || p.length === 0) return p;
			if (p.startsWith("/") || p.startsWith("~")) return p;
			if (knownCwd === "") return p;
			return knownCwd.replace(/\/+$/, "") + "/" + p.replace(/^\.\//, "");
		};
		const fmtDuration = (ms) => {
			if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
			const s = Math.round(ms / 1000);
			if (s < 60) return s + "s";
			const m = Math.floor(s / 60);
			return m + "m" + String(s % 60).padStart(2, "0") + "s";
		};
		const briefArgs = (raw) => {
			if (typeof raw !== "string" || raw.length === 0) return "";
			let s = raw;
			try {
				const o = JSON.parse(raw);
				if (o !== null && typeof o === "object") {
					if (typeof o.command === "string") s = o.command;
					else if (typeof o.path === "string") s = o.path;
					else if (typeof o.file_path === "string") s = o.file_path;
					else if (typeof o.description === "string") s = o.description;
					else s = raw;
				}
			} catch {}
			return s.length > 140 ? s.slice(0, 140) + "…" : s;
		};
		// Parse a bash command that runs a script: returns {script, inputs} or null when
		// the command does not invoke a known script interpreter with a script file.
		const SCRIPT_EXT_SET = new Set(["py", "r", "sh", "bash", "js", "mjs"]);
		const REL_SCRIPT_RE = /(?:^|[\s"'=])([A-Za-z0-9_@%+=:./~-]+\.(?:py|R|sh|bash|js|mjs))(?![A-Za-z0-9])/g;
		const parseBashRun = (raw) => {
			if (typeof raw !== "string" || raw.length === 0) return null;
			let cmd = "";
			try { const o = JSON.parse(raw); if (o !== null && typeof o === "object" && typeof o.command === "string") cmd = o.command; } catch {}
			if (cmd === "") return null;
			// `cd /abs/dir && python3 rel/path.py` — the run lives in the CD'd dir,
			// not the session cwd. Without this, every such run (the standard shape
			// of research sessions) is dropped and its produce edges vanish.
			const cdHit = cmd.match(/(?:^|&&|;|\s)cd\s+((?:\/Users|\/home|\/tmp)\/[A-Za-z0-9_@%+=:./-]+)/);
			const cmdCwd = cdHit !== null ? cdHit[1].replace(/[.,;]+$/, "") : "";
			const paths = cmd.match(FILE_PATH_RE) || [];
			let script = null;
			const inputs = [];
			const plausible = (p) => !/\/\./.test(p) && !/^[.#]/.test(basename(p)) && !/\.(py|sh|R)\//.test(p);
			for (const rawPath of paths) {
				const p = rawPath.replace(/[.,;:]+$/, "");
				const e = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
				if (script === null && SCRIPT_EXT_SET.has(e) && plausible(p)) script = p;
				else if (plausible(p)) inputs.push(p);
			}
			if (script === null) {
				// relative script token: resolve against the command's own cd dir
				for (const m of cmd.slice(0, 2048).matchAll(REL_SCRIPT_RE)) {
					const p = m[1];
					if (p.startsWith("/") || p.includes("://")) continue;
					const abs = (cmdCwd !== "" ? cmdCwd : "") + "/" + p.replace(/^\.\//, "");
					if (script === null) script = abs;
					break;
				}
			}
			return script === null ? null : { script, inputs, cwd: cmdCwd };
		};

		const CSS = [
			".rb-root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:16px 20px 14px;background:var(--dsw-alias-bg-base);}",
			".rb-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:22px;padding:24px 0;}",
			".rb-header{display:flex;align-items:center;gap:14px;padding:2px 2px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}",
			".rb-header-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);letter-spacing:.01em;}",
			".rb-header-stats{display:flex;gap:16px;margin-left:auto;flex:none;}",
			".rb-stat{font-size:12px;color:var(--dsw-alias-label-tertiary);}",
			".rb-stat b{color:var(--dsw-alias-label-primary);font-weight:650;font-variant-numeric:tabular-nums;margin-right:2px;}",
			".rb-btn{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;border:none;border-radius:6px;padding:3px 9px;height:24px;line-height:1;flex:none;}",
			".rb-btn:hover{color:var(--dsw-alias-label-primary);}",
			".rb-btn:disabled{opacity:.45;cursor:default;}",
			".rb-btn-primary{color:var(--dsw-alias-state-business-primary,#2563eb);font-weight:700;}",
			".rb-live{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--dsw-alias-state-error-primary,#e5484d);}",
			".rb-live::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;animation:rb-pulse 1.4s ease-in-out infinite;}",
			"@keyframes rb-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.35;transform:scale(.7);}}",
			".rb-stage{flex:1;min-height:320px;overflow:hidden;position:relative;cursor:grab;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);margin-top:14px;background-image:radial-gradient(color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent) 1px, transparent 1px);background-size:22px 22px;}",
			".rb-stage:active{cursor:grabbing;}",
			".rb-svg{display:block;transform-origin:0 0;will-change:transform;}",
			".rb-node{transform-box:fill-box;transform-origin:center;cursor:pointer;}",
			".rb-node-rect{stroke-width:1;transition:opacity .15s ease;}",
			".rb-node-rect-script{fill:var(--dsw-alias-state-business-tertiary,#e8efff);stroke:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-node-rect-image{fill:var(--dsw-alias-state-success-tertiary);stroke:var(--dsw-alias-state-success-primary,#52c41a);}",
			".rb-node-rect-pdf{fill:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);stroke:var(--dsw-alias-state-error-primary);}",
			".rb-node-rect-text,.rb-node-rect-data{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l2);}",
			".rb-node-rect-agent{fill:color-mix(in srgb, #7c5cff 13%, transparent);stroke:#7c5cff;}",
			".rb-node-rect-commit{fill:color-mix(in srgb, #b8860b 10%, transparent);stroke:#b8860b;stroke-dasharray:4 2;}",
			".rb-node-glyph-commit{fill:#b8860b;}",
			".rb-edge-gitfile{stroke:#d4a017;stroke-width:1.6;opacity:.9;}",
			".rb-edge-gitline{stroke:#d4a017;stroke-width:1.8;stroke-dasharray:5 5;opacity:.85;}",
			".rb-legend{position:absolute;left:12px;top:12px;display:flex;gap:10px;align-items:center;padding:5px 10px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);border:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-tertiary);pointer-events:none;backdrop-filter:blur(3px);}",
			".rb-legend-item{display:inline-flex;align-items:center;gap:4px;}",
			".rb-legend-line{display:inline-block;width:16px;height:0;border-top:2.4px dashed;}",
			".rb-node-act{cursor:pointer;}",
			".rb-node-act rect{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);}",
			".rb-node-act:hover rect{stroke:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-node-acts{opacity:0;transition:opacity .12s ease;pointer-events:none;}",
			".rb-node:hover .rb-node-acts{opacity:1;pointer-events:auto;}",
			".rb-runcard{position:fixed;right:16px;bottom:16px;width:480px;max-width:calc(100vw - 32px);height:300px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.24);z-index:9998;overflow:hidden;font-size:12px;}",
			".rb-runcard.min{height:38px;}",
			".rb-runcard-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;background:var(--dsw-alias-bg-layer-2);}",
			".rb-runcard-body{flex:1;min-height:0;overflow:auto;margin:0;padding:10px 12px;white-space:pre-wrap;font:11.5px/17px var(--ds-font-family-code);color:var(--dsw-alias-label-primary);}",
			".rb-runcard-body.err{color:var(--dsw-alias-state-error-primary);}",
			".rb-runexit-ok{color:var(--dsw-alias-state-success-primary,#52c41a);font-weight:700;}",
			".rb-runexit-bad{color:var(--dsw-alias-state-error-primary);font-weight:700;}",
			".rb-node-act text{font-size:10px;fill:var(--dsw-alias-label-primary);}",
			".rb-shelfbar{position:absolute;left:12px;bottom:12px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l2);background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);color:var(--dsw-alias-label-secondary);font-size:11.5px;cursor:pointer;z-index:6;}",
			".rb-shelfbar:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-tertiary);}",
			".rb-node-label{font-size:11px;fill:var(--dsw-alias-label-primary);pointer-events:none;}",
			".rb-node-glyph{font-size:8.5px;font-weight:800;letter-spacing:.05em;pointer-events:none;}",
			".rb-node-glyph-script{fill:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-node-glyph-image{fill:var(--dsw-alias-state-success-primary,#52c41a);}",
			".rb-node-glyph-pdf{fill:var(--dsw-alias-state-error-primary);}",
			".rb-node-glyph-text,.rb-node-glyph-data{fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-glyph-agent{fill:#7c5cff;}",
			".rb-node-run{font-size:9px;fill:var(--dsw-alias-state-business-primary,#2563eb);pointer-events:none;}",
			".rb-node-pop{animation:rb-pop .46s cubic-bezier(.25,1.2,.4,1) both;}",
			"@keyframes rb-pop{0%{opacity:0;transform:scale(.3);}60%{opacity:1;}100%{opacity:1;transform:scale(1);}}",
			".rb-node-out{animation:rb-out .22s ease forwards;pointer-events:none;}",
			"@keyframes rb-out{to{opacity:0;transform:scale(.82);}}",
			".rb-node-dim{opacity:.14;}",
			".rb-node{transition:opacity .18s ease;}",
			".rb-node-shelf .rb-node-rect{opacity:.6;}",
			".rb-node-shelf .rb-node-label{fill:var(--dsw-alias-label-secondary);}",
			".rb-node-sel .rb-node-rect{stroke-width:2.2;}",
			".rb-halo{fill:none;stroke-width:2;animation:rb-halo 1.1s ease-out 3;pointer-events:none;}",
			"@keyframes rb-halo{from{opacity:.9;}to{opacity:0;}}",
			".rb-edge{fill:none;stroke-width:2.2;opacity:.85;transition:opacity .15s ease;}",
			".rb-edge-produce{stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:2;stroke-dasharray:10 5;animation:rb-flow .8s linear infinite;}",
			".rb-edge-consume{stroke:var(--dsw-alias-label-tertiary);stroke-dasharray:3 4;animation:rb-flow 1.7s linear infinite;}",
			".rb-edge-ran{stroke:#7c5cff;stroke-width:1.8;stroke-dasharray:6 4;animation:rb-flow 1.2s linear infinite;}",
			".rb-edge-cochange{stroke:var(--dsw-alias-border-l3);stroke-dasharray:2 6;opacity:.35;}",
			".rb-node-rect-stage{fill:color-mix(in srgb, var(--dsw-alias-state-business-primary,#2563eb) 8%, var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:1.6;}",
			".rb-node-stage-label{font-size:12.5px;font-weight:650;fill:var(--dsw-alias-label-primary);}",
			".rb-node-stage-status{font-size:13px;}",
			".rb-st-dot{stroke-width:1.8;}",
			".rb-st-ok{fill:var(--dsw-alias-state-success-primary,#52c41a);}",
			".rb-st-partial{fill:none;stroke:#d19a0a;}",
			".rb-st-warn{fill:#e6a23c;}",
			".rb-st-missing{fill:none;stroke:var(--dsw-alias-state-error-primary,#e5484d);}",
			".rb-st-slash{stroke:var(--dsw-alias-state-error-primary,#e5484d);stroke-width:1.8;}",
			".rb-st-auto{fill:none;stroke:var(--dsw-alias-border-l3);}",
			".rb-viewswitch{display:inline-flex;gap:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;}",
			".rb-viewswitch button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;padding:4px 10px;cursor:pointer;}",
			".rb-viewswitch button.rb-vs-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;}",
			".rb-dirover{display:inline-flex;gap:4px;align-items:center;}",
			".rb-dirover input{width:210px;font-size:11px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}",
			".rb-edge-flow{stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:2.6;opacity:.92;fill:none;}",
			".rb-edge-flowlabel{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-rect-ghost{fill:none;stroke:var(--dsw-alias-border-l3);stroke-dasharray:3 3;}",
			".rb-node-rect-stage{fill:color-mix(in srgb, var(--dsw-alias-state-business-primary,#2563eb) 8%, var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:1.6;}",
			".rb-node-stage-label{font-size:12.5px;font-weight:650;fill:var(--dsw-alias-label-primary);}",
			".rb-node-stage-sub{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-label-ghost{fill:var(--dsw-alias-label-quaternary,#999);}",
			".rb-edge-attach{stroke:var(--dsw-alias-label-secondary,#8a8f98);stroke-width:1.6;opacity:.9;}",
			".rb-edge-bloom{opacity:1!important;stroke-width:2.2;animation:rb-edge-in .18s ease both;}",
			".rb-edge-flowlabel{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-label-ghost{fill:var(--dsw-alias-label-quaternary,#999);}",
			".rb-pipe-badge{position:absolute;left:12px;top:44px;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#2563eb) 10%, transparent);border:1px solid var(--dsw-alias-state-business-primary,#2563eb);color:var(--dsw-alias-label-primary);font-size:11px;pointer-events:none;}",
			".rb-edge-edit{stroke:#7c5cff;opacity:.9;stroke-width:1.6;stroke-dasharray:4 4;}",
			".rb-arrow-agent{fill:#7c5cff;}",
			".rb-arrow-git{fill:#d4a017;}",
			".rb-arrow-dot{fill:var(--dsw-alias-label-secondary,#8a8f98);}",
			".rb-shelf-label{font-size:10.5px;fill:var(--dsw-alias-label-tertiary);letter-spacing:.04em;}",
			"@keyframes rb-flow{to{stroke-dashoffset:-30;}}",
			".rb-edge-dim{opacity:.06!important;}",
			".rb-edge-hot{opacity:1;stroke-width:2.4;}",
			".rb-edge-in{animation:rb-edge-in .3s ease both;}",
			"@keyframes rb-edge-in{from{opacity:0;}}",
			".rb-edge-draw{fill:none;stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;animation:rb-draw .48s cubic-bezier(.3,.6,.3,1) forwards,rb-drawfade .3s ease .42s forwards;pointer-events:none;}",
			"@keyframes rb-draw{to{stroke-dashoffset:0;}}",
			"@keyframes rb-drawfade{to{opacity:0;}}",
			".rb-edge-draw-produce{stroke:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-edge-draw-consume{stroke:var(--dsw-alias-label-tertiary);}",
			".rb-dot{pointer-events:none;}",
			".rb-dot-produce{fill:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-dot-consume{fill:var(--dsw-alias-label-tertiary);opacity:.5;}",
			".rb-arrow{fill:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-arrow-consume{fill:var(--dsw-alias-label-tertiary);}",
			".rb-dag-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:20px 0;}",
			".rb-inspector{position:absolute;right:12px;bottom:12px;width:300px;max-width:calc(100% - 24px);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.18);padding:12px 13px;font-size:12px;animation:rb-insp .18s ease-out;z-index:5;}",
			"@keyframes rb-insp{from{opacity:0;transform:translateY(8px);}}",
			".rb-insp-head{display:flex;align-items:center;gap:8px;}",
			".rb-insp-name{font-weight:650;font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;}",
			".rb-insp-close{background:transparent;border:none;color:var(--dsw-alias-label-tertiary);font-size:15px;cursor:pointer;padding:0 4px;line-height:1;flex:none;}",
			".rb-insp-close:hover{color:var(--dsw-alias-label-primary);}",
			".rb-insp-path{color:var(--dsw-alias-label-tertiary);font-size:10.5px;word-break:break-all;line-height:15px;margin:5px 0 7px;font-family:var(--ds-font-family-code);}",
			".rb-insp-meta{color:var(--dsw-alias-label-secondary);line-height:19px;margin-bottom:8px;}",
			".rb-narr{border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px;padding-top:8px;max-height:240px;overflow-y:auto;}",
			".rb-narr-title{font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary);margin-bottom:6px;letter-spacing:.02em;}",
			".rb-narr-fr{border-left:2px solid var(--dsw-alias-border-l2);padding:4px 8px;margin-bottom:6px;border-radius:0 6px 6px 0;background:var(--dsw-alias-interactive-bg-hover);}",
			".rb-narr-det{margin-top:4px;}",
			".rb-narr-det summary{cursor:pointer;font-size:10px;color:var(--dsw-alias-state-business-primary,#2563eb);user-select:none;}",
			".rb-narr-you{border-left-color:var(--dsw-alias-state-business-primary,#2563eb);}",
			".rb-narr-bot{border-left-color:var(--dsw-alias-label-tertiary);}",
			".rb-narr-who{display:block;font-size:10px;font-weight:650;color:var(--dsw-alias-label-tertiary);margin-bottom:2px;}",
			".rb-narr-txt{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}",
			".rb-insp-meta b{color:var(--dsw-alias-label-primary);font-weight:600;}",
			".rb-insp-actions{display:flex;gap:6px;flex-wrap:wrap;}",
			".rb-insp-explain{margin-top:9px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary);}",
			".rb-explain-muted{color:var(--dsw-alias-label-tertiary);}",
			".rb-explain-err{color:var(--dsw-alias-state-error-primary);}",
			".rb-turnbar{flex:none;display:flex;align-items:center;gap:10px;padding:12px 2px 0;}",
			".rb-turnbar-info{flex:1;min-width:0;display:flex;align-items:center;gap:10px;}",
			".rb-turnbar-cut{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;min-width:86px;}",
			".rb-turnbar-cut b{color:var(--dsw-alias-label-primary);font-weight:650;}",
			".rb-turnbar-summary{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}",
			".rb-slider-wrap{flex:2.2;min-width:160px;display:flex;align-items:center;}",
			".rb-slider{-webkit-appearance:none;appearance:none;flex:1;height:7px;border-radius:4px;outline:none;margin:0;cursor:pointer;background:var(--dsw-alias-border-l2);}",
			".rb-slider::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;background:#fff;border:3.5px solid var(--dsw-alias-state-business-primary,#2563eb);box-shadow:0 1px 5px rgba(0,0,0,.3);cursor:grab;}",
			".rb-slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:3.5px solid var(--dsw-alias-state-business-primary,#2563eb);box-shadow:0 1px 5px rgba(0,0,0,.3);cursor:grab;}",
			".avt-lightbox{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:rgba(10,10,14,.92);backdrop-filter:blur(2px);}",
			".avt-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;color:#fff;background:rgba(20,20,26,.85);}",
			".avt-bar-title{font-size:13px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}",
			".avt-bar-actions{display:flex;align-items:center;gap:6px;flex:none;}",
			".avt-btn{background:rgba(127,127,127,.25);color:#fff;font:inherit;font-size:13px;cursor:pointer;border:none;border-radius:6px;padding:4px 10px;}",
			".avt-btn:hover{background:rgba(127,127,127,.45);}",
			".avt-btn-close{font-size:16px;padding:4px 12px;}",
			".avt-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;}",
			".avt-img{max-width:92vw;max-height:calc(100vh - 150px);object-fit:contain;user-select:none;}",
			".avt-failed{color:#fff;text-align:center;font-size:13px;line-height:2;}",
			".avt-failed-path{opacity:.7;font-size:12px;word-break:break-all;}",
			".avt-hint{text-align:center;color:rgba(160,160,170,.8);font-size:11px;padding:6px 0 4px;}",
			".avt-textwrap{flex:1;min-height:0;overflow:auto;margin:0;padding:14px 18px;color:#e8e8ea;font:12px/19px var(--ds-font-family-code);white-space:pre;tab-size:2;}",
		].join("\n");
		if (typeof document !== "undefined") {
			// ALWAYS sync the stylesheet: after a hot reload the old <style> tag is still
			// in document.head, and a "only inject if missing" guard would keep serving
			// stale CSS forever — making every later client.js change invisible.
			let tag = document.querySelector("style[data-plugin-css=\"dsh-plugin-runbook/client\"]");
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = "dsh-plugin-runbook";
				tag.dataset.pluginCss = "dsh-plugin-runbook/client";
				document.head.appendChild(tag);
			}
			if (tag.textContent !== CSS) tag.textContent = CSS;
		}

		const NS = "runbook";
		const dicts = {
			zh: {
				"view.runbook": "运行本",
				"rb.empty": "还没有回合。开始对话后，这里会把每回合的产物连成一张数据流图。",
				"rb.dagEmpty": "暂无产物节点 —— 跑一个脚本（例如 python3 xxx.py）产出文件后，这里会连成脚本↔产物的数据流。",
				"rb.reset": "复位",
				"rb.fit": "适配视图",
				"rb.live": "LIVE",
				"rb.stageHint": "滚轮按档缩放 · 拖拽平移 · 双击适配 · 点节点看详情",
				"rb.loadOlder": "← 加载更早的回合",
				"rb.turn": "回合",
				"rb.turns": "回合",
				"rb.files": "产物",
				"rb.narrTitle": "叙述引文",
				"rb.narrYou": "你",
				"rb.narrBot": "助手",
				"rb.narrFull": "展开全文",
				"rb.scripts": "脚本",
				"rb.links": "连线",
				"rb.open": "打开",
				"rb.preview": "预览",
				"rb.openTab": "新标签页打开",
				"rb.openSystem": "系统打开",
				"rb.run": "运行脚本",
				"rb.running": "运行中",
				"rb.explain": "解释",
				"rb.explaining": "解释中…",
				"rb.explainFile": "解释这个文件",
				"rb.loading": "加载中…",
				"rb.failed": "无法加载（文件可能已被移动或删除）",
				"rb.noActivity": "本回合无工具调用记录",
				"rb.activity": "调用了",
				"rb.explainFail": "解释失败：",
				"rb.bornAt": "出现于",
			"rb.git": "Git",
			"rb.gitDirty": "未提交改动",
			"rb.shelf": "背景 · 仅在输出中被提及的文件",
			"rb.agentSession": "子 agent 会话（跨会话执行）",
			"rb.shelfCount": "背景文件 {n}",
			"rb.shelfExpand": "展开",
			"rb.shelfCollapse": "收起",
			"rb.shelfHint": "未参与任何数据流的文件，按目录分组收纳",
				"rb.scanBadge": "磁盘扫描（会话未记录）",
				"rb.static": "静态分析",
				"rb.pipeBadge": "PIPELINE.md 主链骨架",
				"rb.pipeGhost": "未在磁盘找到（缺口）",
				"rb.pipeFile": "挂靠文件",
				"rb.stages": "环",
				"rb.lgAttach": "挂靠",
				"rb.runMin": "最小化",
				"rb.runExpand": "展开",
				"rb.ek.produce": "产出（脚本 → 文件）",
				"rb.ek.consume": "消费（文件 → 脚本）",
				"rb.ek.ran": "agent 运行过此脚本",
				"rb.ek.edit": "agent 写入/修改",
				"rb.ek.gitfile": "git 提交包含此文件",
				"rb.ek.gitline": "提交时间链",
				"rb.ek.attach": "文件挂靠到阶段",
				"rb.ek.flow": "主链数据流",
				"rb.ek.cochange": "同提交共变",
				"rb.pipeInferred": "推断主链（零 API，可写 PIPELINE.md 固化）",
				"rb.vsAuto": "自动",
				"rb.vsStage": "主链",
				"rb.vsStageHint": "悬停任意环节，绽放相关会话流（运行/消费/git/agent）",
				"rb.vsFlow": "会话流",
				"rb.dirPlaceholder": "项目绝对路径…",
				"rb.dirHint": "回车切换到任意项目目录，不依赖当前会话",
				"rb.dirAuto": "回到自动探测",
				"rb.commitNode": "Git 提交",
				"rb.lgProduce": "产生",
				"rb.lgConsume": "消费",
				"rb.lgAgent": "agent",
				"rb.lgCommit": "提交",
			"rb.stageHint": "滚轮按档缩放 · 拖拽平移 · 双击适配 · 点节点看详情",
				"rb.producedBy": "产生方式",
				"rb.upstream": "上游",
				"rb.none": "无",
				"hint": "滚轮缩放 · 拖拽平移 · 双击复位 · Esc 关闭",
			},
			en: {
				"view.runbook": "Runbook",
				"rb.empty": "No turns yet. Start a conversation and produced files will form a data-flow graph here.",
				"rb.dagEmpty": "No artifact nodes yet — run a script (e.g. python3 xxx.py) that produces files and the script↔artifact flow will appear.",
				"rb.reset": "Reset",
				"rb.fit": "Fit view",
				"rb.live": "LIVE",
				"rb.stageHint": "Wheel zoom · drag pan · double-click fit · click a node for details",
				"rb.loadOlder": "← Load older turns",
				"rb.turn": "Turn",
				"rb.turns": "turns",
				"rb.files": "files",
				"rb.narrTitle": "narrative fragments",
				"rb.narrYou": "you",
				"rb.narrBot": "assistant",
				"rb.narrFull": "full quote",
				"rb.scripts": "scripts",
				"rb.links": "edges",
				"rb.open": "Open",
				"rb.preview": "Preview",
				"rb.openTab": "Open in tab",
				"rb.openSystem": "Open in system",
				"rb.run": "Run script",
				"rb.running": "Running",
				"rb.explain": "Explain",
				"rb.explaining": "Explaining…",
				"rb.explainFile": "Explain this file",
				"rb.loading": "Loading…",
				"rb.failed": "Cannot load (file may have moved or been deleted)",
				"rb.noActivity": "No tool calls recorded for this turn",
				"rb.activity": "Called",
				"rb.explainFail": "Explain failed: ",
				"rb.bornAt": "Appeared",
			"rb.git": "Git",
			"rb.gitDirty": "uncommitted",
			"rb.shelf": "Background · files only mentioned in output",
			"rb.agentSession": "subagent session (cross-session run)",
			"rb.shelfCount": "background files: {n}",
			"rb.shelfExpand": "show",
			"rb.shelfCollapse": "hide",
			"rb.shelfHint": "Files not part of any data flow, grouped by directory",
				"rb.scanBadge": "disk scan (not in session log)",
				"rb.static": "static analysis",
				"rb.pipeBadge": "PIPELINE.md backbone",
				"rb.pipeGhost": "not on disk (gap)",
				"rb.pipeFile": "attached file",
				"rb.stages": "stages",
				"rb.lgAttach": "attached",
				"rb.runMin": "minimize",
				"rb.runExpand": "expand",
				"rb.ek.produce": "produces (script → file)",
				"rb.ek.consume": "consumes (file → script)",
				"rb.ek.ran": "agent ran this script",
				"rb.ek.edit": "agent wrote/edited",
				"rb.ek.gitfile": "git commit touched this file",
				"rb.ek.gitline": "commit chain",
				"rb.ek.attach": "file attached to stage",
				"rb.ek.flow": "backbone flow",
				"rb.ek.cochange": "co-changed in one commit",
				"rb.pipeInferred": "inferred backbone (zero API; write a PIPELINE.md to pin it)",
				"rb.vsAuto": "auto",
				"rb.vsStage": "backbone",
				"rb.vsStageHint": "hover any stage to bloom its session flow (runs/consumes/git/agent)",
				"rb.vsFlow": "session flow",
				"rb.dirPlaceholder": "absolute project path…",
				"rb.dirHint": "Enter to retarget any project dir, independent of this session",
				"rb.dirAuto": "back to auto-detect",
				"rb.commitNode": "Git commit",
				"rb.lgProduce": "produces",
				"rb.lgConsume": "consumes",
				"rb.lgAgent": "agent",
				"rb.lgCommit": "commit",
				"rb.producedBy": "Produced by",
				"rb.upstream": "Upstream",
				"rb.none": "none",
				"hint": "Wheel zoom · drag pan · double-click reset · Esc close",
			},
		};

		// ---------- image lightbox store ----------
		let imgState = { open: false, paths: [], index: 0 };
		const imgListeners = new Set();
		const imgEmit = () => { for (const fn of imgListeners) fn(); };
		const imgStore = {
			subscribe(fn) { imgListeners.add(fn); return () => { imgListeners.delete(fn); }; },
			get: () => imgState,
			open(paths, index) { imgState = { open: true, paths: paths.slice(), index: Math.max(0, Math.min(index, paths.length - 1)) }; imgEmit(); },
			move(delta) { if (!imgState.open || imgState.paths.length < 2) return; const n = imgState.paths.length; imgState = { ...imgState, index: (((imgState.index + delta) % n) + n) % n }; imgEmit(); },
			close() { imgState = { open: false, paths: [], index: 0 }; imgEmit(); },
		};
		function useImg() {
			const [state, setState] = React.useState(imgStore.get);
			React.useEffect(() => imgStore.subscribe(() => setState(imgStore.get())), []);
			return state;
		}

		// ---------- text viewer store ----------
		let txtState = { open: false, path: "", text: "", error: "", loading: false };
		const txtListeners = new Set();
		const txtEmit = () => { for (const fn of txtListeners) fn(); };
		const txtStore = {
			subscribe(fn) { txtListeners.add(fn); return () => { txtListeners.delete(fn); }; },
			get: () => txtState,
			async open(path) {
				txtState = { open: true, path, text: "", error: "", loading: true };
				txtEmit();
				try {
					const res = await fetch(fileUrl(path));
					if (!res.ok) throw new Error("HTTP " + res.status);
					const text = await res.text();
					if (txtState.path === path) { txtState = { open: true, path, text, error: "", loading: false }; txtEmit(); }
				} catch (error) {
					if (txtState.path === path) { txtState = { open: true, path, text: "", error: String(error && error.message ? error.message : error), loading: false }; txtEmit(); }
				}
			},
			close() { txtState = { open: false, path: "", text: "", error: "", loading: false }; txtEmit(); },
		};
		function useTxt() {
			const [state, setState] = React.useState(txtStore.get);
			React.useEffect(() => txtStore.subscribe(() => setState(txtStore.get)), []);
			return state;
		}

		// ---------- script run store ----------
		let runState = { open: false, path: "", cwd: "", running: false, exitCode: null, signal: null, stdout: "", stderr: "", error: "", timedOut: false };
		const runListeners = new Set();
		const runEmit = () => { for (const fn of runListeners) fn(); };
		const runStore = {
			subscribe(fn) { runListeners.add(fn); return () => { runListeners.delete(fn); }; },
			get: () => runState,
			async open(path, cwd) {
				runState = { open: true, path, cwd, running: true, exitCode: null, signal: null, stdout: "", stderr: "", error: "", timedOut: false };
				runEmit();
				try {
					const res = await fetch("agent-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, cwd }) });
					let j = null;
					try { j = await res.json(); } catch { j = null; }
					if (!res.ok) throw new Error(j !== null && typeof j === "object" && typeof j.error === "string" ? j.error : "HTTP " + res.status);
					runState = {
						open: true, path, cwd, running: false,
						exitCode: j !== null && typeof j === "object" && typeof j.exitCode === "number" ? j.exitCode : null,
						signal: j !== null && typeof j === "object" && j.signal ? j.signal : null,
						stdout: j !== null && typeof j === "object" && typeof j.stdout === "string" ? j.stdout : "",
						stderr: j !== null && typeof j === "object" && typeof j.stderr === "string" ? j.stderr : "",
						error: j !== null && typeof j === "object" && typeof j.error === "string" ? j.error : "",
						timedOut: j !== null && typeof j === "object" && j.timedOut === true,
					};
					runEmit();
				} catch (error) {
					runState = { open: true, path, cwd, running: false, exitCode: null, signal: null, stdout: "", stderr: "", error: String(error && error.message ? error.message : error), timedOut: false };
					runEmit();
				}
			},
			close() { runState = { open: false, path: "", cwd: "", running: false, exitCode: null, signal: null, stdout: "", stderr: "", error: "", timedOut: false }; runEmit(); },
		};
		function useRun() {
			const [state, setState] = React.useState(runStore.get);
			React.useEffect(() => runStore.subscribe(() => setState(runStore.get())), []);
			return state;
		}

		// ---------- produced-files + activity + model accumulator ----------
		// NARRATIVE BY CURRENT TURN: a user/message carries no turn id but arrives
		// ~20ms AFTER the turn/start that opened its turn (turn/start seq 6 -> user
		// seq 9). So text attaches to the most recently started turn. Replay-safe:
		// every delivery deduped by event seq.
		var narrCurrentTurn = -1;
		var narrUserByTurn = new Map();
		var narrSeenSeq = new Set();
		const userNarrOf = (turnNum) => (narrUserByTurn.get(Number(turnNum)) || "");
		const artifactDefinition = {
			kind: "runbook-artifacts",
			match: (event) => {
				try {
					if (event === null || typeof event !== "object") return null;
					const type = event.type;
					const data = event.data;
					// NARRATIVE: user messages carry no turn id and arrive BEFORE the
					// turn they open — buffer the text; the next turn/start claims it.
					if (type === "user/message" && data !== null && typeof data === "object" && Array.isArray(data.content)) {
						const seq = event.seq;
						if (seq !== undefined && narrSeenSeq.has(seq)) return null;
						let txt = "";
						for (const b2 of data.content) { if (b2 !== null && typeof b2 === "object" && typeof b2.text === "string") txt += (txt === "" ? "" : "\n") + b2.text; }
						txt = txt.trim();
						if (txt.length > 0 && !txt.startsWith("<system-reminder>") && !txt.startsWith("<compacted-summary>") && !txt.startsWith("[Request interrupted") && !txt.startsWith("background job")) {
							if (seq !== undefined) narrSeenSeq.add(seq);
							if (narrCurrentTurn >= 0) {
								const prev = narrUserByTurn.get(narrCurrentTurn) || "";
								if (prev.length < 1200) narrUserByTurn.set(narrCurrentTurn, (prev === "" ? "" : prev + "\n") + txt.slice(0, 1200 - prev.length));
							}
						}
						return null;
					}
					if (type === "turn/start") { narrCurrentTurn = Number(data.turn); return { id: String(data.turn), role: "start" }; }
					if (type === "tool/result" || type === "tool/call" || type === "assistant/message") return { id: String(data.turn), role: "update" };
					return null;
				} catch {
					return null;
				}
			},
			start: (_context, match) => {
				const data = match !== null && typeof match === "object" && match.event !== null && typeof match.event === "object" ? match.event.data : null;
				return { turn: data !== null && data.turn !== undefined ? data.turn : -1, files: [], reads: [], activity: [], runs: [], pendingBash: {}, model: null, assistantText: "" };
			},
			update: (context, match) => {
				// update() replays the full window on every open/resync: cap scanned bytes so giant tool results can't stall the main thread.
				const SCAN_CAP = 262144;
				try {
					const type = match.event.type;
					const state = context.state;
					if (type === "assistant/message") {
					const msg = match.event.data && match.event.data.message;
					const src = msg && msg.source;
					// NARRATIVE: the visible answer text (content blocks of type "text")
					// is the turn's conclusion — quoted verbatim, no LLM involved.
					let addText = "";
					if (msg !== null && typeof msg === "object" && Array.isArray(msg.content)) {
						for (const b2 of msg.content) {
							if (b2 !== null && typeof b2 === "object" && b2.type === "text" && typeof b2.text === "string") addText += (addText === "" ? "" : "\n") + b2.text;
						}
					}
					if (addText.length > 0) {
						// Long turns: keep the head (plan) AND the tail (conclusion —
						// where "RMSE 8.94" lands after a background job reports back).
						// A head-only cap amputated every conclusion.
						const joined = (state.assistantText === "" ? "" : state.assistantText + "\n") + addText;
						state.assistantText = joined.length <= 1600 ? joined : joined.slice(0, 400) + "\n…\n" + joined.slice(joined.length - 1000);
					}
					if (src && typeof src.provider === "string" && typeof src.model === "string") {
						const model = { provider: src.provider, model: src.model };
						if (state.model !== null && state.model.provider === model.provider && state.model.model === model.model) return state;
						return { ...state, model };
					}
					return state;
				}
					if (type === "tool/call") {
						const d = match.event.data || {};
						const tool = typeof d.name === "string" ? d.name : "tool";
						const brief = briefArgs(d.arguments);
						const activity = state.activity.length >= 40 ? state.activity : state.activity.concat([{ tool, brief }]);
						// Input files (reads) = absolute paths referenced in the call arguments.
						let reads = state.reads;
						if (typeof d.arguments === "string" && d.arguments.length > 0) {
							const found = d.arguments.slice(0, SCAN_CAP).match(FILE_PATH_RE);
							if (found !== null) {
								const known = new Set(state.reads);
								let changed = false;
								for (const raw of found) {
									const p = raw.replace(/[.,;:]+$/, "");
									if (known.has(p) || reads.length >= 40) continue;
									known.add(p);
									reads = reads.concat([p]);
									changed = true;
								}
								if (!changed) reads = state.reads;
							}
						}
						let pendingBash = state.pendingBash;
						if (tool === "bash" && typeof d.callId === "string") {
							const run = parseBashRun(d.arguments);
							if (run !== null) pendingBash = { ...state.pendingBash, [d.callId]: run };
						}
						// Editing IS producing: write/edit tool calls modify a file on disk, but
						// their results never echo the path — capture the target here so plugin
						// development itself grows visible nodes in the runbook.
						let files = state.files;
						if ((tool === "write" || tool === "edit") && typeof d.arguments === "string" && d.arguments.length > 0 && d.arguments.length <= 262144 && state.files.length < 30) {
							try {
								const o = JSON.parse(d.arguments);
								const p = o !== null && typeof o === "object" && typeof o.file_path === "string" ? o.file_path : null;
								// Store raw (normalized when cwd is known): the gate ran BEFORE
								// knownCwd was set on replayed sessions and silently dropped every
								// relative write. Admission filtering happens at graph build.
								const np2 = normPath(p);
								if (typeof np2 === "string" && np2.length > 0 && state.files.indexOf(np2) < 0) files = state.files.concat([np2]);
							} catch {}
						}
						if (activity === state.activity && reads === state.reads && pendingBash === state.pendingBash && files === state.files) return state;
						return { ...state, activity, reads, pendingBash, files };
					}
					if (type === "tool/result") {
						const message = match.event.data.message;
						const content = message !== null && typeof message === "object" && Array.isArray(message.content) ? message.content : [];
						if (content.length === 0) return state;
						const first = content[0];
						if (first !== null && typeof first === "object" && first.isError === true) return state;
						let text = "";
						for (const block of content) {
							if (block === null || typeof block !== "object") continue;
							if (typeof block.text === "string") text += "\n" + block.text;
							if (Array.isArray(block.content)) {
								for (const inner of block.content) {
									if (inner !== null && typeof inner === "object" && typeof inner.text === "string") text += "\n" + inner.text;
								}
							}
							if (text.length >= SCAN_CAP) break;
						}
						if (text.length === 0) return state;
						const found = text.slice(0, SCAN_CAP).match(FILE_PATH_RE) || [];
						// Research runs echo RELATIVE outputs ("project/results/x/fig.png"):
						// the run knows its own `cd` dir, so those echoes are resolvable.
						const pending = state.pendingBash[(message !== null && typeof message === "object" && message.source !== null && typeof message.source === "object" ? message.source.callId : undefined) || ""];
						if (found.length === 0 && pending !== undefined && typeof pending.cwd === "string" && pending.cwd.length > 0) {
							for (const m of text.slice(0, SCAN_CAP).matchAll(REL_FILE_RE)) {
								const rel = m[1];
								if (rel.startsWith("/") || rel.includes("://")) continue;
								if (/(?:^|\/)\./.test(rel)) continue;
								found.push(pending.cwd.replace(/\/+$/, "") + "/" + rel);
								if (found.length >= 14) break;
							}
						}
						if (found.length === 0) return state;
						const known = new Set(state.files);
						let files = state.files;
						// newFiles = genuinely NEW paths, independent of the display cap: run
						// pairing (script -> outputs) must survive even when the file list is
						// full, or the whole graph silently loses its edges.
						const newFiles = [];
						for (const raw of found) {
							const p = raw.replace(/[.,;:]+$/, "");
							if (known.has(p)) continue;
							known.add(p);
							newFiles.push(p);
							if (files.length < 120) files = files.concat([p]);
						}
						// Correlate a bash script run with its produced files (callId pairing).
						let runs = state.runs;
						let pendingBash = state.pendingBash;
						const callId = message !== null && typeof message === "object" && message.source !== null && typeof message.source === "object" ? message.source.callId : undefined;
						if (typeof callId === "string" && state.pendingBash[callId] !== undefined && newFiles.length > 0 && state.runs.length < 60) {
							const run = state.pendingBash[callId];
							runs = state.runs.concat([{ script: run.script, inputs: run.inputs, outputs: newFiles }]);
							const nextPending = { ...state.pendingBash };
							delete nextPending[callId];
							pendingBash = nextPending;
						}
						if (files === state.files && runs === state.runs && pendingBash === state.pendingBash) return state;
						return { ...state, files, runs, pendingBash };
					}
					return state;
				} catch {
					return context.state;
				}
			},
			buildLocationData: (context, scope) => {
				try {
					if (scope !== "turn" || context.state === undefined) return null;
					const s = context.state;
					return { kind: "turn", turn: s.turn, key: "runbook-artifacts", value: { files: s.files, reads: s.reads, activity: s.activity, runs: s.runs, pendingBash: s.pendingBash, model: s.model, assistantText: s.assistantText === undefined ? "" : s.assistantText } };
				} catch {
					return null;
				}
			},
		};

		function collectTurnData(turn) {
			const files = [];
			const seen = new Set();
			let reads = [];
			let activity = [];
			let runs = [];
			let model = null;
			const del = turn.data.get("deliverables");
			if (del !== undefined && Array.isArray(del.produced)) {
				for (const it of del.produced) {
					if (it !== null && typeof it === "object" && typeof it.path === "string" && it.path.length > 0 && !seen.has(it.path)) { seen.add(it.path); files.push(it.path); }
				}
			}
			const art = turn.data.get("runbook-artifacts");
			if (art !== undefined && art !== null) {
				if (Array.isArray(art.files)) {
					for (const p of art.files) if (typeof p === "string" && p.length > 0 && !seen.has(p)) { seen.add(p); files.push(p); }
				}
				if (Array.isArray(art.reads)) reads = art.reads;
				if (Array.isArray(art.activity)) activity = art.activity;
				if (Array.isArray(art.runs)) runs = art.runs;
			// Background-job bash runs (run_in_background) never pair: their outputs
			// arrive via job_output under a different callId. The script + its read
			// inputs still deserve graph presence; scan static-IO supplies produces.
			if (art.pendingBash !== null && typeof art.pendingBash === "object") {
				const seen = new Set(runs.map((r2) => r2 !== null && typeof r2 === "object" ? r2.script : ""));
				for (const run of Object.values(art.pendingBash)) {
					if (run === null || typeof run !== "object" || typeof run.script !== "string" || seen.has(run.script)) continue;
					runs = runs.concat([{ script: run.script, inputs: run.inputs || [], outputs: [] }]);
				}
			}
				if (art.model !== undefined && art.model !== null && typeof art.model.provider === "string") model = art.model;
			}
			// Normalize BEFORE anything downstream sees a path: fallbackDir,
			// buildFileGraph, ledger, and scan-target inference all key on absolute.
			return {
				assistantText: typeof art === "object" && art !== null && typeof art.assistantText === "string" ? art.assistantText : "",
				files: files.map(normPath),
				reads: reads.map(normPath),
				activity,
				runs: runs.map((r) => (r === null || typeof r !== "object") ? r : {
					...r,
					script: normPath(r.script),
					inputs: Array.isArray(r.inputs) ? r.inputs.map(normPath) : r.inputs,
					outputs: Array.isArray(r.outputs) ? r.outputs.map(normPath) : r.outputs,
				}),
				model,
			};
		}

		function summarizeActivity(activity) {
			const names = [];
			for (const a of activity) {
				const n = a && typeof a.tool === "string" ? a.tool : "tool";
				if (names.indexOf(n) < 0) names.push(n);
				if (names.length >= 10) break;
			}
			return names;
		}

		async function postExplain(prompt, model) {
			if (model === null || typeof model.provider !== "string" || typeof model.model !== "string" || model.provider === "" || model.model === "") {
				throw new Error("no-model");
			}
			const res = await fetch("agent-explain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider: model.provider, model: model.model, prompt }),
			});
			let j = null;
			try { j = await res.json(); } catch { j = null; }
			if (j !== null && typeof j === "object" && typeof j.error === "string") throw new Error(j.error);
			if (!res.ok) throw new Error("HTTP " + res.status);
			if (j === null || typeof j !== "object") throw new Error("bad response");
			return typeof j.text === "string" ? j.text : "";
		}

		function buildExplainPrompt(activity, files) {
			const tools = summarizeActivity(activity).join(", ") || "(无)";
			const names = files.map(basename).slice(0, 12).join(", ") || "(无)";
			return [
				"请用一句中文白话（不超过 60 字）解释这个 agent 回合做了什么。",
				"工具调用：" + tools,
				"产出文件：" + names,
			].join("\n");
		}

		async function explainTurn(data) {
			const prompt = buildExplainPrompt(data.activity, data.files);
			// Turn's own model first; when it is unknown (or the call fails) fall back
			// to the Zhipu coding-plan route already configured in DSH settings.
			if (data.model !== null) {
				try { return await postExplain(prompt, data.model); } catch {}
			}
			return postExplain(prompt, { provider: "zai-coding-cn", model: "glm-5.3" });
		}

		function buildFileExplainPrompt(node, activity) {
			const lines = [
				"请用一句中文白话（不超过 60 字）说明这个文件在 agent 任务流水线中的角色，以及它是怎么来的。",
				"文件：" + basename(node.path) + "（" + node.kind + "）",
			];
			if (node.producedBy !== null) {
				lines.push("产生它的脚本：" + basename(node.producedBy.scriptPath) + "（第 " + node.producedBy.turnNum + " 回合运行）");
				if (Array.isArray(node.producedBy.inputs) && node.producedBy.inputs.length > 0) {
					lines.push("脚本上游输入：" + node.producedBy.inputs.map(basename).slice(0, 8).join(", "));
				}
			} else {
				lines.push("来历：无脚本运行记录（出现在第 " + node.turnNum + " 回合的工具输出里）");
			}
			const tools = summarizeActivity(activity).join(", ");
			if (tools !== "") lines.push("该回合调用的工具：" + tools);
			return lines.join("\n");
		}

		function fileKindOf(path) {
			if (isRunnable(path)) return "script";
			const k = kindOf(path);
			if (k === "image") return "image";
			if (k === "pdf") return "pdf";
			if (k === "text") return "text";
			return "data";
		}
		const glyphOf = (node) => node.kind === "image" ? "IMG" : node.kind === "pdf" ? "PDF" : node.kind === "agent" ? "BOT" : node.kind === "commit" ? "GIT" : node.kind === "script" ? extOf(node.path).toUpperCase().slice(0, 4) : extOf(node.path).toUpperCase().slice(0, 4) || "FILE";

		// File-level provenance graph: every captured file becomes a node (first turn it
		// appears in = its birth turn); runs add "produce" (script -> artifact) and
		// "consume" (artifact -> downstream script) edges. The git ledger then adds the
		// "main program": files changed in commits or sitting uncommitted that the
		// conversation never echoed — bucketed onto the turn timeline by commit time.
		function buildFileGraph(timeline, git, subruns, ledger, scan) {
			const nodeMap = new Map();
			const edges = [];
			const seenEdge = new Set();
			const ensure = (path, tIdx) => {
				const existing = nodeMap.get(path);
				if (existing === undefined) {
					const node = { id: path, path, kind: fileKindOf(path), label: basename(path), tIdx, turnNum: timeline.turnOrder[tIdx], producedBy: null };
					nodeMap.set(path, node);
					return node;
				}
				if (tIdx < existing.tIdx) { existing.tIdx = tIdx; existing.turnNum = timeline.turnOrder[tIdx]; }
				return existing;
			};
			const addEdge = (from, to, kind, tIdx) => {
				if (from === to) return;
				const key = from + ">" + kind + ">" + to;
				if (seenEdge.has(key)) return;
				seenEdge.add(key);
				if (edges.length < 150) edges.push({ from, to, kind, tIdx, key });
			};
			// Pass order = priority: run participants (the graph's backbone) first, then
			// plain files. A turn-1 `ls` flood must never crowd the actual pipeline out
			// of the 120-node window — that made every edge (and the graph) vanish.
			const passRuns = [];
			const passFiles = [];
			for (let i = 0; i < timeline.turnOrder.length; i++) {
				const turn = timeline.turns.get(timeline.turnOrder[i]);
				if (turn === undefined) continue;
				const data = collectTurnData(turn);
				passRuns.push({ i, data });
				if (data.files.length > 0) passFiles.push({ i, files: data.files });
			}
			for (const { i, data } of passRuns) {
				for (const run of data.runs) {
					const script = ensure(run.script, i);
					const outSet = new Set(run.outputs);
					for (const inp of run.inputs) { if (outSet.has(inp)) continue; const n = ensure(inp, i); addEdge(n.id, script.id, "consume", i); }
					for (const out of run.outputs) {
						const n = ensure(out, i);
						addEdge(script.id, n.id, "produce", i);
						if (n.producedBy === null) n.producedBy = { scriptPath: run.script, inputs: run.inputs.slice(), turnNum: timeline.turnOrder[i] };
					}
				}
			}
			// Workspace scan (host /agent-scan): REAL files on disk, statically parsed.
			// This is what makes un-run / un-pushed research code visible — the graph
			// no longer depends on the session having recorded anything. Runs before
			// echoed noise so actual project files win the node budget.
			if (scan !== null && scan !== undefined && Array.isArray(scan.files)) {
				// Scripts enter FIRST: a walk-order file cap crowded them out on big
				// repos (experiments/ sorts late), leaving every static IO edge dead.
				const scriptSet = new Set();
				for (const sc of Array.isArray(scan.scripts) ? scan.scripts : []) {
					if (sc !== null && typeof sc === "object" && typeof sc.path === "string" && nodeMap.size < 110) {
						const n = ensure(sc.path, 0);
						if (n !== undefined) { n.scan = true; scriptSet.add(sc.path); }
					}
				}
				// Scripts reference IO by repo-relative or script-relative strings, but
				// scan keys nodes by ABSOLUTE path — exact-match linking misses most of
				// them. Basemap by basename (unique matches only) so `fig_dz_single_repro.png`
				// in code links to the real scanned file however it was spelled.
				const byBaseIdx = new Map();
				const addRef = (ref, abs) => {
					const b2 = basename(ref);
					if (!byBaseIdx.has(b2)) byBaseIdx.set(b2, []);
					byBaseIdx.get(b2).push(abs);
				};
				for (const n of nodeMap.values()) addRef(n.path, n.id);
				for (const f of scan.files) if (typeof f.abs === "string" && !nodeMap.has(f.abs)) addRef(f.abs, f.abs);
				const resolveScanRef = (ref) => {
					if (nodeMap.has(ref)) return ref;
					const hits = byBaseIdx.get(basename(ref));
					if (hits === undefined || hits.length !== 1) return null;
					// Linked IO earns its node even past the walk cap: edges are the graph.
					if (nodeMap.size < 130) { const n = ensure(hits[0], 0); if (n !== undefined) n.scan = true; }
					return hits[0];
				};
				for (const sc of Array.isArray(scan.scripts) ? scan.scripts : []) {
					if (sc === null || typeof sc !== "object" || typeof sc.path !== "string") continue;
					const script = nodeMap.get(sc.path);
					if (script === undefined) continue;
					for (const r of Array.isArray(sc.reads) ? sc.reads : []) {
						const rid = resolveScanRef(r);
						if (rid !== null) addEdge(rid, sc.path, "consume", 0);
					}
					for (const w of Array.isArray(sc.writes) ? sc.writes : []) {
						const wid = resolveScanRef(w);
						if (wid === null) continue;
						addEdge(sc.path, wid, "produce", 0);
						const n = nodeMap.get(wid);
						if (n !== undefined && n.producedBy === null) n.producedBy = { scriptPath: sc.path, inputs: (sc.reads || []).slice(), turnNum: null };
					}
				}
			}
			// Blind scan fill goes LAST: linked evidence (runs, script IO, git) owns
			// the node budget first; walk-order noise only pads the remainder.
			if (scan !== null && scan !== undefined && Array.isArray(scan.files)) {
				for (const f of scan.files) {
					if (nodeMap.size >= 120) break;
					const n = ensure(f.abs, 0);
					if (n !== undefined) n.scan = true;
				}
			}
			for (const { i, files } of passFiles) {
				// Plain echoed paths are background clutter (mostly `ls` floods): cap them
				// well below the node budget so the pipeline stays the visual center.
				for (const p of files) { if (nodeMap.size >= 60) break; if (isCapturedPath(p)) ensure(p, i); }
			}
			// Cross-session handoff: child-agent runs/edits come from THEIR session
			// logs (host /agent-subruns). An agent node links to the scripts it ran
			// and the files it edited; task-input paths already present in this graph
			// become consume edges — the parent→child file handoff made visible.
			if (Array.isArray(subruns)) {
				const lastIdx = Math.max(0, timeline.turnOrder.length - 1);
				for (const sub of subruns) {
					if (sub === null || typeof sub !== "object" || typeof sub.id !== "string") continue;
					const agentId = "agent:" + sub.id;
					const agentLabel = typeof sub.label === "string" && sub.label !== "" ? sub.label : "subagent";
					nodeMap.set(agentId, { id: agentId, path: sub.id, kind: "agent", label: agentLabel.slice(0, 16), tIdx: lastIdx, turnNum: timeline.turnOrder[lastIdx], producedBy: null });
					const subRuns = Array.isArray(sub.runs) ? sub.runs.slice(0, 40) : [];
					const scripts = [];
					for (const run of subRuns) {
						if (run === null || typeof run !== "object" || typeof run.script !== "string") continue;
						const script = ensure(run.script, lastIdx);
						scripts.push(script.id);
						addEdge(agentId, script.id, "ran", lastIdx);
						const outSet = new Set(Array.isArray(run.outputs) ? run.outputs : []);
						for (const inp of Array.isArray(run.inputs) ? run.inputs : []) {
							if (outSet.has(inp)) continue;
							// Skip the reverse of a known produce edge: a re-run with
							// `--out data.csv` lists data.csv as a CLI path, not a real input.
							if (seenEdge.has(script.id + ">produce>" + inp)) continue;
							const n = ensure(inp, lastIdx);
							addEdge(n.id, script.id, "consume", lastIdx);
						}
						for (const out of Array.isArray(run.outputs) ? run.outputs : []) {
							const n = ensure(out, lastIdx);
							addEdge(script.id, n.id, "produce", lastIdx);
							if (n.producedBy === null) n.producedBy = { scriptPath: run.script, inputs: [], turnNum: timeline.turnOrder[lastIdx] };
						}
					}
					// Handoff inputs: artifacts from this graph that the child's task or
					// its scripts' own code reference → consume edges (scripts excluded:
					// prose mentions everything, artifacts that feed scripts are the truth).
					const handoff = (Array.isArray(sub.taskInputs) ? sub.taskInputs : []).concat(Array.isArray(sub.reads) ? sub.reads : []);
					for (const hp of handoff.slice(0, 24)) {
						const node = nodeMap.get(hp);
						if (node === undefined || node.kind === "script") continue;
						for (const sid of scripts.slice(0, 2)) addEdge(hp, sid, "consume", lastIdx);
					}
					const childOutputs = new Set();
					for (const run of subRuns) if (Array.isArray(run.outputs)) for (const o of run.outputs) childOutputs.add(o);
					for (const ed of Array.isArray(sub.edits) ? sub.edits.slice(0, 30) : []) {
						if (ed === null || typeof ed !== "object" || typeof ed.path !== "string") continue;
						ed = { ...ed, path: normPath(ed.path) };
						if (!isCapturedPath(ed.path)) continue;
						const n = ensure(ed.path, lastIdx);
						addEdge(agentId, n.id, "edit", lastIdx);
						if (n.agent === undefined) n.agent = agentLabel;
						// The script's own code references its inputs: consume edges for
						// refs that are known nodes and not the child's own outputs.
						if (isRunnable(ed.path)) {
							for (const ref of Array.isArray(ed.refs) ? ed.refs : []) {
								if (childOutputs.has(ref)) continue;
								const rn = nodeMap.get(ref);
								if (rn === undefined || rn.kind === "script") continue;
								addEdge(ref, ed.path, "consume", lastIdx);
							}
						}
					}
				}
			}
			if (git !== null && git !== undefined && git.ok === true && typeof git.cwd === "string" && git.cwd.length > 0) {
				const root = git.cwd.replace(/\/+$/, "");
				const times = [];
				for (const n of timeline.turnOrder) {
					const tu = timeline.turns.get(n);
					times.push(tu !== undefined && tu.start !== undefined && typeof tu.start.time === "number" ? tu.start.time : Number.POSITIVE_INFINITY);
				}
				// Commit time -> turn index; anything older than the session lands on turn 0
				// so the pre-existing codebase is visible from the very start of the slider.
				const bucketOf = (ms) => {
					let idx = -1;
					for (let i = 0; i < times.length; i++) if (times[i] <= ms) idx = i;
					return idx === -1 ? 0 : idx;
				};
				const absorb = (rel, tIdx, info) => {
					if (typeof rel !== "string" || rel === "") return;
					const abs = root + "/" + rel;
					if (!isCapturedPath(abs)) return;
					const existing = nodeMap.get(abs);
					if (existing !== undefined) {
						if (existing.git === undefined) existing.git = info;
						if (tIdx < existing.tIdx) { existing.tIdx = tIdx; existing.turnNum = timeline.turnOrder[tIdx]; }
						return;
					}
					if (nodeMap.size >= 130) return;
					nodeMap.set(abs, { id: abs, path: abs, kind: fileKindOf(abs), label: basename(abs), tIdx, turnNum: timeline.turnOrder[tIdx], producedBy: null, git: info });
				};
				if (Array.isArray(git.commits)) {
					// Commit nodes: the git history becomes REAL graph structure — each
					// commit a node, chained oldest→newest, its files hanging off it.
					// This replaces pairwise co-change edges: participation through a
					// shared commit is the honest provenance git gives us.
					let commitCount = 0;
					let prevCommitId = null;
					for (let ci = git.commits.length - 1; ci >= 0; ci--) {
						const c = git.commits[ci];
						if (c === null || typeof c !== "object" || !Array.isArray(c.files)) continue;
						const tIdx = bucketOf(typeof c.at === "number" ? c.at * 1000 : 0);
						const info = { subject: typeof c.subject === "string" ? c.subject : "", at: typeof c.at === "number" ? c.at : 0, dirty: false };
						const present = [];
						for (const f of c.files.slice(0, 10)) absorb(typeof f === "string" ? f : f.p, tIdx, typeof f === "string" ? info : { ...info, status: f.s });
						for (const f of c.files.slice(0, 10)) {
							const abs = root + "/" + (typeof f === "string" ? f : f.p);
							if (nodeMap.has(abs)) present.push(abs);
						}
						if (present.length === 0 || commitCount >= 16 || nodeMap.size >= 130) continue;
						const hash = typeof c.hash === "string" ? c.hash : "";
						const commitId = "commit:" + hash;
						if (!nodeMap.has(commitId)) {
							const subject = info.subject.replace(/\s+/g, " ");
							nodeMap.set(commitId, {
								id: commitId, path: commitId, kind: "commit",
								label: (hash.slice(0, 6) || "?") + " " + (subject.length > 12 ? subject.slice(0, 11) + "…" : subject),
								tIdx, turnNum: timeline.turnOrder[tIdx], producedBy: null, git: info,
							});
							commitCount++;
						}
						for (const abs of present) addEdge(commitId, abs, "gitfile", tIdx);
						if (prevCommitId !== null) addEdge(prevCommitId, commitId, "gitline", tIdx);
						prevCommitId = commitId;
					}
				}
				if (Array.isArray(git.dirty)) {
					const last = Math.max(0, timeline.turnOrder.length - 1);
					for (const rel of git.dirty) absorb(typeof rel === "string" ? rel : rel.p, last, { subject: "", at: 0, dirty: true });
				}
			}
			// Persistent ledger (host /agent-ledger): runs/edits recorded in past
			// sessions of this workspace. These edges survive compaction and restarts —
			// the timeline may have paged them out, the ledger has not.
			if (Array.isArray(ledger)) {
				const times2 = [];
				for (const n of timeline.turnOrder) {
					const tu = timeline.turns.get(n);
					times2.push(tu !== undefined && tu.start !== undefined && typeof tu.start.time === "number" ? tu.start.time : Number.POSITIVE_INFINITY);
				}
				const bucketOf = (ms) => {
					let idx = -1;
					for (let i = 0; i < times2.length; i++) if (times2[i] <= ms) idx = i;
					return idx === -1 ? 0 : idx;
				};
				for (const e of ledger.slice(0, 200)) {
					if (e === null || typeof e !== "object") continue;
					if (e.kind === "run" && typeof e.script === "string") {
						const i = bucketOf(typeof e.ts === "number" ? e.ts : 0);
						const script = ensure(e.script, i);
						const outSet = new Set(Array.isArray(e.outputs) ? e.outputs : []);
						for (const inp of Array.isArray(e.inputs) ? e.inputs : []) {
							if (outSet.has(inp) || seenEdge.has(script.id + ">produce>" + inp)) continue;
							addEdge(ensure(inp, i).id, script.id, "consume", i);
						}
						for (const out of Array.isArray(e.outputs) ? e.outputs : []) {
							const n = ensure(out, i);
							addEdge(script.id, n.id, "produce", i);
						}
					} else if (e.kind === "edit" && typeof e.path === "string") {
						ensure(e.path, bucketOf(typeof e.ts === "number" ? e.ts : 0));
					}
				}
			}
			const nodes = [...nodeMap.values()].slice(0, 132);
			const ids = new Set(nodes.map((n) => n.id));
			return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
		}

		// Simple rank (longest-path) layout on the FULL graph: positions stay stable
		// while scrubbing, so new nodes pop into fixed slots instead of reshuffling.
		// Edge-less nodes (raw `ls` echoes, stray artifacts) never join the main flow —
		// they used to all land in column 0 and stack into one giant vertical strip.
		// They go to a compact "shelf" grid below the pipeline instead.
		function layoutFileGraph(nodes, edges, includeShelf) {
			const linked = new Set();
			for (const e of edges) { linked.add(e.from); linked.add(e.to); }
			const flow = nodes.filter((n) => linked.has(n.id));
			const shelf = nodes.filter((n) => !linked.has(n.id)).slice(0, 24);
			const byId = new Map(flow.map((n) => [n.id, n]));
			const preds = new Map(flow.map((n) => [n.id, []]));
			for (const e of edges) {
				if (byId.has(e.from) && byId.has(e.to)) preds.get(e.to).push(e.from);
			}
			const rank = new Map();
			const inProgress = new Set();
			const visit = (id) => {
				if (rank.has(id)) return rank.get(id);
				if (inProgress.has(id)) return 0; // cycle guard — rank stays finite
				inProgress.add(id);
				const ps = preds.get(id) || [];
				const r = ps.length === 0 ? 0 : Math.max(...ps.map(visit)) + 1;
				inProgress.delete(id);
				rank.set(id, r);
				return r;
			};
			for (const n of flow) visit(n.id);
			const byRank = new Map();
			for (const n of flow) {
				const r = rank.get(n.id);
				if (!byRank.has(r)) byRank.set(r, []);
				byRank.get(r).push(n);
			}
			const ranks = [...byRank.keys()].sort((a, b) => a - b);
			// O(1) rank→column and node→row lookups: indexOf per node was O(n²) overall.
			const colIndex = new Map(ranks.map((r, i) => [r, i]));
			const rowIndex = new Map();
			for (const arr of byRank.values()) arr.forEach((n, i) => rowIndex.set(n.id, i));
			// Comfortable horizontal rhythm: columns wide enough that the connecting
			// edges read as arrows (not 74px slivers), branches offset to distinct rows.
			const COL_W = 300;
			const ROW_H = 96;
			const NODE_W = 158;
			const NODE_H = 36;
			const flowH = 32 + Math.max(1, ...[...byRank.values()].map((arr) => arr.length)) * ROW_H;
			const placed = flow.map((n) => {
				const r = rank.get(n.id);
				return { ...n, x: 18 + colIndex.get(r) * COL_W, y: 16 + rowIndex.get(n.id) * ROW_H, w: NODE_W, h: NODE_H, rank: r };
			});
			// Shelf: orphan files clustered BY DIRECTORY under the pipeline — a flat
			// grid of unrelated names reads as noise; per-directory groups explain
			// where each cluster came from at a glance.
			const SHELF_COLS = 5;
			const shelfTop = 16 + Math.ceil(flowH / ROW_H) * ROW_H + 46;
			const groups = new Map();
			for (const n of shelf) {
				const at = n.path.lastIndexOf("/");
				const dir = at > 0 ? n.path.slice(0, at) : "(root)";
				if (!groups.has(dir)) groups.set(dir, []);
				groups.get(dir).push(n);
			}
			const shelfGroups = [];
			let gy = shelfTop;
			if (includeShelf !== false) {
				for (const [dir, arr] of groups) {
					shelfGroups.push({ dir: dir.length > 58 ? "…" + dir.slice(-57) : dir, y: gy });
					gy += 17;
					placed.push(...arr.map((n, i) => ({
						...n, x: 18 + (i % SHELF_COLS) * 178, y: gy + Math.floor(i / SHELF_COLS) * 44, w: 158, h: 32, rank: 0, shelf: true,
					})));
					gy += Math.ceil(arr.length / SHELF_COLS) * 44 + 12;
				}
			}
			const posMap = new Map(placed.map((n) => [n.id, n]));
			const placedEdges = edges.filter((e) => posMap.has(e.from) && posMap.has(e.to));
			const maxRows = Math.max(1, ...[...byRank.values()].map((arr) => arr.length));
			const width = 36 + ranks.length * COL_W;
			if (includeShelf === false) {
				// Collapsed shelf: the flow alone defines the canvas — fit-view sizes
				// to the pipeline, not the background noise. Count is still reported
				// so the toggle bar can advertise what is hidden.
				return { nodes: placed, edges: placedEdges, width, height: 32 + maxRows * ROW_H, shelfY: undefined, shelfGroups: [], shelfCount: shelf.length };
			}
			const height = shelf.length > 0 ? gy + 8 : 32 + maxRows * ROW_H;
			return { nodes: placed, edges: placedEdges, width: Math.max(width, 36 + SHELF_COLS * 178), height, shelfY: shelf.length > 0 ? shelfTop - 14 : undefined, shelfGroups: shelf.length > 0 ? shelfGroups : [], shelfCount: shelf.length };
		}

		const edgeD = (a, b) => {
			const x1 = a.x + a.w;
			const y1 = a.y + a.h / 2;
			const x2 = b.x;
			const y2 = b.y + b.h / 2;
			const mx = (x1 + x2) / 2;
			return "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2;
		};

		function previewFile(path) {
			const k = kindOf(path);
			if (k === "image") imgStore.open([path], 0);
			else if (k === "text") txtStore.open(path);
			else if (typeof window !== "undefined") window.open(fileUrl(path), "_blank");
		}

		// ---------- the living DAG (single view) ----------
		// Semantic status badge (SVG): no emoji — a colored dot whose FILL encodes
		// the state: solid = complete, ring = partial (data ignored), filled amber =
		// warning, ring+slash = missing, grey ring = inferred/unknown.
		function StageBadge(props) {
			const { status, x, y } = props;
			const kind = status === "💀" ? "missing" : status === "⚠️" ? "warn" : status === "🔶" ? "partial" : status === "✅" ? "ok" : "auto";
			return React.createElement("g", { transform: "translate(" + x + "," + y + ")" },
				React.createElement("circle", { r: 5, className: "rb-st-dot rb-st-" + kind }),
				kind === "missing" ? React.createElement("line", { x1: -3.6, y1: 3.6, x2: 3.6, y2: -3.6, className: "rb-st-slash" }) : null,
			);
		}

		// Zero-API backbone: the static-IO graph (disk scan) already IS a pipeline
		// candidate — scripts chained through shared data files. No PIPELINE.md and
		// no LLM call needed; the curated doc is just an optional human override.
		// Backbone inference straight from the disk scan's static IO: script A
		// writes file X, script B reads X => A -> B. Zero API, zero session data.
		function inferPipelineFromScan(scan) {
			if (scan === null || !Array.isArray(scan.scripts) || scan.scripts.length < 2) return null;
			const baseOf = (p) => p.slice(p.lastIndexOf("/") + 1);
			const writer = new Map();
			for (const sc of scan.scripts) for (const w of sc.writes || []) if (!writer.has(w)) writer.set(w, sc.path);
			const nodes = scan.scripts.map((sc) => ({
				id: sc.path,
				label: baseOf(sc.path),
				status: "",
				files: [...new Set([...(sc.reads || []), ...(sc.writes || [])])].map(baseOf).slice(0, 12),
			}));
			const edges = [];
			const seen = new Set();
			for (const sc of scan.scripts) {
				for (const r of sc.reads || []) {
					const src = writer.get(r);
					if (src === undefined || src === sc.path) continue;
					const k = src + ">" + sc.path;
					if (seen.has(k)) continue;
					seen.add(k);
					edges.push({ from: src, to: sc.path, label: baseOf(r) });
				}
			}
			if (edges.length === 0) return null;
			return { found: true, inferred: true, nodes, edges };
		}

		function inferPipeline(graph) {
			const isFlow = (e) => e.kind === "produce" || e.kind === "consume";
			const outs = new Map();
			const ins = new Map();
			for (const e of graph.edges) {
				if (!isFlow(e)) continue;
				if (e.kind === "produce" && !outs.has(e.from)) outs.set(e.from, []);
				if (e.kind === "produce") outs.get(e.from).push(e.to);
				if (e.kind === "consume" && !ins.has(e.to)) ins.set(e.to, []);
				if (e.kind === "consume") ins.get(e.to).push(e.from);
			}
			const scripts = graph.nodes.filter((n) => n.kind === "script" && (outs.get(n.id) !== undefined || ins.get(n.id) !== undefined));
			if (scripts.length < 2) return null;
			const byId = new Map(scripts.map((n) => [n.id, n]));
			const edges = [];
			for (const s of scripts) {
				for (const o of outs.get(s.id) || []) {
					for (const t of scripts) {
						if (t.id === s.id) continue;
						if ((ins.get(t.id) || []).includes(o) && !edges.some((e) => e.from === s.id && e.to === t.id)) edges.push({ from: s.id, to: t.id, label: "" });
					}
				}
			}
			if (edges.length === 0) return null;
			const nodes = scripts.map((s) => ({
				id: s.id,
				label: s.label,
				status: "",
				files: [...new Set([...(ins.get(s.id) || []), ...(outs.get(s.id) || [])])].map((p) => p.slice(p.lastIndexOf("/") + 1)).slice(0, 12),
			}));
			return { found: true, inferred: true, nodes, edges };
		}

		// Backbone layout: SAME output contract as layoutFileGraph (nodes with
		// x/y/w/h/rank/tIdx + edges + width/height). That contract is what lets the
		// graph keep EVERY interaction (scrub, hover chips, inspector, explain,
		// zoom, fit) in backbone mode — the backbone is a layout, not a separate view.
		function layoutBackbone(graph, pipeline) {
			const stageById = new Map(pipeline.nodes.map((n) => [n.id, n]));
			const byBase = new Map();
			for (const n of graph.nodes) {
				const b = n.path.slice(n.path.lastIndexOf("/") + 1);
				if (!byBase.has(b)) byBase.set(b, n);
			}
			const preds = new Map();
			for (const e of pipeline.edges) {
				if (!preds.has(e.to)) preds.set(e.to, []);
				preds.get(e.to).push(e.from);
			}
			const rank = new Map();
			const inProg = new Set();
			const visit = (id) => {
				if (rank.has(id)) return rank.get(id);
				if (inProg.has(id)) return 0;
				inProg.add(id);
				const ps = preds.get(id) || [];
				const r = ps.length === 0 ? 0 : Math.max(...ps.map(visit)) + 1;
				inProg.delete(id);
				rank.set(id, r);
				return r;
			};
			for (const n of pipeline.nodes) visit(n.id);
			const cols = new Map();
			for (const n of pipeline.nodes) {
				const r = rank.get(n.id) || 0;
				if (!cols.has(r)) cols.set(r, []);
				cols.get(r).push(n.id);
			}
			const COL_W = 316;
			const placed = [];
			const edges = [];
			const stageBox = new Map();
			for (const [r, ids] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
				let y = 18;
				for (const id of ids) {
					const st = stageById.get(id);
					const files = (st.files || []).slice(0, 8).map((fname) => {
							const real = byBase.get(fname);
							if (real !== undefined) return real;
							return { id: "ghost:" + id + ":" + fname, path: fname, kind: "ghost", label: fname.slice(fname.lastIndexOf("/") + 1), tIdx: 0, turnNum: null, producedBy: null };
						});
					const box = { id: "stage:" + id, path: id, kind: "stage", label: st.label || id, tIdx: 0, turnNum: null, producedBy: null, stageStatus: st.status || "", x: 18 + r * COL_W, y, w: 288, h: 54 + (files.length > 0 ? 30 + files.length * 34 : 0), rank: r };
					stageBox.set(id, box);
					placed.push(box);
					files.forEach((f, fi) => {
							const fp = { ...f, x: box.x + 14, y: box.y + 58 + fi * 34, w: 240, h: 28, rank: r };
							placed.push(fp);
							edges.push({ from: box.id, to: fp.id, kind: "attach", tIdx: 0, key: "at:" + id + ":" + fi });
						});
					y += box.h + 26;
				}
			}
			for (const e of pipeline.edges) {
				const a2 = stageBox.get(e.from);
				const b2 = stageBox.get(e.to);
				if (a2 !== undefined && b2 !== undefined) edges.push({ from: a2.id, to: b2.id, kind: "flow", tIdx: 0, key: "fl:" + e.from + ">" + e.to, label: e.label || "" });
			}
			const width = 18 + (cols.size + 1) * COL_W;
			const height = Math.max(140, ...placed.map((n) => n.y + n.h)) + 24;
			return { nodes: placed, edges, width, height, shelfY: undefined, shelfGroups: [], shelfCount: 0 };
		}

		function GraphView(props) {
			const { timeline, gitData, subruns, ledger, scan, backbone, viewMode, openFile, runScript, t } = props;
			const [scale, setScale] = React.useState(1);
			const [offset, setOffset] = React.useState({ x: 0, y: 0 });
			const [cutRaw, setCutRaw] = React.useState(null); // null = follow live (always newest)
			const [hoverId, setHoverId] = React.useState(null);
			const [selectedId, setSelectedId] = React.useState(null);
			const [shelfOpen, setShelfOpen] = React.useState(false);
			// Explain state lives HERE (not in the inspector) so the ✨ chip on a node
			// can trigger it directly — the feature is part of the graph again.
			const [explain, setExplain] = React.useState({ status: "idle", text: "", key: null });
			const [camMode, setCamMode] = React.useState("glide"); // none(drag) | quick(wheel) | glide(fit)
			const camTimer = React.useRef(0);
			const mountedRef = React.useRef(false);
			// Edges animate their draw-in ONCE per key. Async data (git/scan/ledger)
			// arrives in waves and each arrival rebuilds the graph — without this
			// gate every rebuild replayed the whole growth animation, and mid-replay
			// every line sits collapsed on its producer (dashoffset≈1 sliver).
			const seenEdgeKeys = React.useRef(new Set());
			const stageRef = React.useRef(null);
			const dragRef = React.useRef(null);
			const userMoved = React.useRef(false);
			const dimsRef = React.useRef("");

			const graph = React.useMemo(() => {
				const g = buildFileGraph(timeline, gitData, subruns, ledger, scan);
				// One view, two layouts: backbone (curated or inferred) and session
				// flow share this component, so no interaction is ever lost by
				// switching modes.
				const useBackbone = backbone !== null && viewMode === "stage";
				const laid = useBackbone ? layoutBackbone(g, backbone) : layoutFileGraph(g.nodes, g.edges, shelfOpen);
				const byId = new Map(laid.nodes.map((n) => [n.id, n]));
				const adj = new Map();
				const neighbors = new Map();
				const touch = (id, key) => {
					let set = adj.get(id);
					if (set === undefined) { set = new Set(); adj.set(id, set); }
					set.add(key);
				};
				const link = (a, b) => {
					let s = neighbors.get(a);
					if (s === undefined) { s = new Set(); neighbors.set(a, s); }
					s.add(b);
				};
				// Pre-bake edge geometry + adjacency once per layout: rendering then never
				// recomputes geometry, so React renders stay cheap (no per-frame work).
				for (const e of laid.edges) {
					e.d = edgeD(byId.get(e.from), byId.get(e.to));
					touch(e.from, e.key);
					touch(e.to, e.key);
					link(e.from, e.to);
					link(e.to, e.from);
				}
				// Where each node grows FROM: the side facing its producing script. A new
				// artifact scales out of its producer instead of popping out of nowhere.
				const producer = new Map();
				for (const e of laid.edges) if (e.kind === "produce" && !producer.has(e.to)) producer.set(e.to, e.from);
				for (const n of laid.nodes) {
					const pid = producer.get(n.id);
					const p = pid === undefined ? undefined : byId.get(pid);
					if (p === undefined) n.origin = "50% 50%";
					else if (Math.abs(p.x - n.x) > 8) n.origin = p.x < n.x ? "0% 50%" : "100% 50%";
					else n.origin = p.y < n.y ? "50% 0%" : "50% 100%";
				}
				return { ...laid, byId, adj, neighbors, rawEdges: g.edges, rawById: new Map(g.nodes.map((n) => [n.id, n])) };
			}, [timeline, gitData, subruns, ledger, scan, shelfOpen, backbone, viewMode]);

			const maxIdx = timeline.turnOrder.length;
			const cut = cutRaw === null || cutRaw > maxIdx ? maxIdx : Math.max(0, cutRaw);
			const live = cut === maxIdx;

			// Turns that introduce something new — tick marks on the slider.
			const newAt = React.useMemo(() => {
				const arr = new Array(maxIdx).fill(0);
				for (const n of graph.nodes) if (n.tIdx < maxIdx) arr[n.tIdx] += 1;
				return arr;
			}, [graph, maxIdx]);
			const eventCuts = React.useMemo(() => {
				const list = [];
				for (let i = 0; i < maxIdx; i++) if (newAt[i] > 0) list.push(i + 1);
				return list;
			}, [newAt, maxIdx]);

			// Backward scrub: nodes dissolve out instead of popping out of existence.
			const [exiting, setExiting] = React.useState(() => ({}));
			const prevCutRef = React.useRef(cut);
			React.useEffect(() => {
				const prev = prevCutRef.current;
				prevCutRef.current = cut;
				if (cut >= prev) return undefined;
				const leaving = graph.nodes.filter((n) => n.tIdx >= cut && n.tIdx < prev).map((n) => n.id);
				if (leaving.length === 0) return undefined;
				setExiting((e) => {
					const m = { ...e };
					for (const id of leaving) m[id] = true;
					return m;
				});
				const id = setTimeout(() => {
					setExiting((e) => {
						const m = { ...e };
						for (const id2 of leaving) delete m[id2];
						return m;
					});
				}, 270);
				return () => clearTimeout(id);
			}, [cut, graph]);

			const glide = React.useCallback((fn) => {
				setCamMode("glide");
				if (camTimer.current !== 0) clearTimeout(camTimer.current);
				camTimer.current = setTimeout(() => { camTimer.current = 0; setCamMode("quick"); }, 780);
				fn();
			}, []);

			// Explain runner: node-first entry (✨ chip) and inspector button share it.
			const runExplain = (node) => {
				if (node === null || explain.status === "loading") return;
				setExplain({ status: "loading", text: "", key: node.id });
				const turn = timeline.turns.get(node.turnNum);
				const data = turn === undefined ? { files: [], reads: [], activity: [], runs: [], model: null } : collectTurnData(turn);
				const prompt = buildFileExplainPrompt(node, data.activity);
				const run = () => new Promise((resolve, reject) => {
					// Fire the session model AND glm in parallel; first NON-EMPTY answer
					// wins. The session model often answers blank-fast, glm is reliable
					// but slow (~30s on long prompts) — sequential fallback meant the
					// chip could spin for half a minute before even trying glm.
					const attempts = [];
					if (data.model !== null) attempts.push(postExplain(prompt, data.model));
					attempts.push(postExplain(prompt, { provider: "zai-coding-cn", model: "glm-5.3" }));
					let settled = 0;
					for (const p of attempts) {
						p.then((r) => {
							if (typeof r === "string" && r.trim().length > 0) resolve(r);
							else if (++settled === attempts.length) reject(new Error("empty"));
						}).catch(() => {
							if (++settled === attempts.length) reject(new Error("all-failed"));
						});
					}
				});
				run().then((text) => {
					setExplain({ status: "done", text, key: node.id });
				}).catch((err) => {
					const msg = err && err.message === "no-model" ? t("rb.explainFail") + "无法确定模型" : t("rb.explainFail") + String(err && err.message ? err.message : err);
					setExplain({ status: "error", text: msg, key: node.id });
				});
			};

			const fit = React.useCallback(() => {
				const el = stageRef.current;
				if (el === null || graph.nodes.length === 0) return;
				const r = el.getBoundingClientRect();
				if (r.width <= 0 || r.height <= 0) return;
				const s = Math.min(1.15, Math.max(0.22, Math.min(r.width / graph.width, r.height / graph.height) * 0.96));
				glide(() => { setScale(s); setOffset({ x: (r.width - graph.width * s) / 2, y: (r.height - graph.height * s) / 2 }); });
			}, [graph, glide]);
			// Fit on mount and whenever the canvas grows — unless the user took manual control.
			React.useEffect(() => {
				const dims = graph.width + "x" + graph.height;
				if (dimsRef.current === dims) return;
				dimsRef.current = dims;
				if (!userMoved.current) fit();
			}, [graph, fit]);

			React.useEffect(() => {
				if (selectedId === null || typeof window === "undefined") return undefined;
				const onKey = (e) => { if (e.key === "Escape") setSelectedId(null); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [selectedId]);

			// Discrete zoom steps (macOS-style detents) anchored at the cursor. Wheel
			// deltas ACCUMULATE to a threshold first, so a mouse notch = one step while
			// a trackpad's small deltas need a full gesture — gentler for the hand.
			const ZOOM_STEPS = [0.25, 0.35, 0.45, 0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.75, 2.1, 2.5];
			const wheelAcc = React.useRef(0);
			const stepIndexFor = (s) => {
				let best = 0;
				for (let i = 1; i < ZOOM_STEPS.length; i++) if (Math.abs(ZOOM_STEPS[i] - s) <= Math.abs(ZOOM_STEPS[best] - s)) best = i;
				return best;
			};
			const onWheel = (e) => {
				e.preventDefault();
				userMoved.current = true;
				if (camMode !== "glide") setCamMode("quick");
				wheelAcc.current += e.deltaY;
				const TH = 160;
				let dir = 0;
				while (wheelAcc.current >= TH) { dir += 1; wheelAcc.current -= TH; }
				while (wheelAcc.current <= -TH) { dir -= 1; wheelAcc.current += TH; }
				if (dir === 0) return;
				const idx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, stepIndexFor(scale) + dir));
				const next = ZOOM_STEPS[idx];
				if (next === scale) { wheelAcc.current = 0; return; }
				const rect = stageRef.current !== null ? stageRef.current.getBoundingClientRect() : null;
				if (rect === null) { setScale(next); return; }
				const mx = e.clientX - rect.left;
				const my = e.clientY - rect.top;
				const wx = (mx - offset.x) / scale;
				const wy = (my - offset.y) / scale;
				setScale(next);
				setOffset({ x: mx - wx * next, y: my - wy * next });
			};
			const onDown = (e) => { dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; setCamMode("none"); };
			const onMove = (e) => { if (dragRef.current === null) return; userMoved.current = true; setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }); };
			const onUp = () => { if (dragRef.current !== null) { dragRef.current = null; setCamMode("quick"); } };
			const resetAll = () => { userMoved.current = false; setCutRaw(null); setSelectedId(null); fit(); };

			const activeId = hoverId !== null ? hoverId : selectedId;
			const activeEdges = activeId === null ? null : (graph.adj.get(activeId) || new Set());
			// ---- Bloom: hovering a backbone stage blossoms the SESSION-FLOW edges
			// incident to that stage's files (runs/consumes/git/agent), drawn from
			// the file's real position to the counterpart wherever it lives. The
			// backbone is the table of contents; the bloom is the chapter reading.
			const [bloomId, setBloomId] = React.useState(null);
			const bloomEdges = React.useMemo(() => {
				if (bloomId === null || backbone === null || viewMode !== "stage") return [];
				const st = backbone.nodes.find((n) => n.id === bloomId);
				if (st === undefined) return [];
				const files = new Set(st.files || []);
				const base = (p2) => p2.slice(p2.lastIndexOf("/") + 1);
				const out = [];
				for (const e of graph.rawEdges) {
					// e.from/e.to are NODE IDS ("file:x", "turn:n"), not paths — resolve
					// through the session graph's own id->node map before basename.
					const na = graph.rawById.get(e.from);
					const nb = graph.rawById.get(e.to);
					if (na === undefined || nb === undefined) continue;
					const fromIn = files.has(base(na.path)), toIn = files.has(base(nb.path));
					if (!fromIn && !toIn) continue;
					const a = graph.byId.get(e.from), b2 = graph.byId.get(e.to);
					if (a === undefined || b2 === undefined) continue;
					out.push({ key: "bloom:" + e.key, from: e.from, to: e.to, kind: e.kind, d: edgeD(a, b2) });
					if (out.length >= 30) break;
				}
				return out;
			}, [bloomId, backbone, graph]);
			// Bloom endpoints join the focus set so their nodes don't dim.
			const bloomFocus = React.useMemo(() => {
				const set = new Set();
				for (const e of bloomEdges) { set.add(e.from); set.add(e.to); }
				return set;
			}, [bloomEdges]);

			const neighborIds = React.useMemo(() => {
				if (activeId === null) return null;
				// HOVER LENS: not one hop — the transitive dependency CONE. Upstream
				// (what fed this node, recursively) + downstream (what it produced).
				// Depth-capped and size-capped so huge repos stay instant. This is
				// the "hover expands, leave re-aggregates" feel: the cone lights up
				// while the rest of the graph recedes, and it all runs on the
				// pre-baked adjacency — no layout, no geometry change, pure CSS
				// opacity transitions, so it stays perfectly smooth.
				const fwd = new Map();
				const bwd = new Map();
				for (const e of graph.edges) {
					if (!fwd.has(e.from)) fwd.set(e.from, []);
					fwd.get(e.from).push(e.to);
					if (!bwd.has(e.to)) bwd.set(e.to, []);
					bwd.get(e.to).push(e.from);
				}
				const set = new Set([activeId]);
				let frontier = [activeId];
				for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
					const next = [];
					for (const id of frontier) {
						for (const map of [fwd, bwd]) {
							for (const n of map.get(id) || []) {
								if (set.has(n)) continue;
								set.add(n);
								if (set.size >= 48) return set;
								next.push(n);
							}
						}
					}
					frontier = next;
				}
				for (const id of bloomFocus) set.add(id);
				return set;
			}, [activeId, graph, bloomFocus]);

			// ---- Hover EXPAND: neighbours physically fan out, hovered node grows,
			// edges re-route live. rAF-eased (not CSS) because edge paths must follow
			// moving nodes; transforms are written to the SVG transform ATTRIBUTE via
			// DOM, which React never owns, so re-renders can't fight it. ----
			const nodeElsRef = React.useRef(new Map());
			const edgeElsRef = React.useRef(new Map());
			const fanRef = React.useRef({ raf: 0, t0: 0, dur: 240, progress: 0, hover: null, from: new Map(), to: new Map(), cur: new Map(), active: false });
			const basePos = graph.byId;
			const fanTargets = (hoverId) => {
				const to = new Map();
				const h = basePos.get(hoverId);
				if (h === undefined) return to;
				const hx = h.x + h.w / 2;
				const hy = h.y + h.h / 2;
				for (const nid of graph.neighbors.get(hoverId) || []) {
					const n = basePos.get(nid);
					if (n === undefined || n.shelf === true) continue;
					const dx = (n.x + n.w / 2) - hx;
					const dy = (n.y + n.h / 2) - hy;
					const len = Math.hypot(dx, dy) || 1;
					const push = Math.max(18, Math.min(46, 260 / len));
					to.set(nid, { dx: (dx / len) * push, dy: (dy / len) * push });
				}
				return to;
			};
			const posOf = (id) => {
				const b = basePos.get(id);
				if (b === undefined) return null;
				const o = fanRef.current.cur.get(id);
				return o === undefined ? b : { ...b, x: b.x + o.dx, y: b.y + o.dy };
			};
			const applyFan = () => {
				const f = fanRef.current;
				for (const [id, o] of f.cur) {
					const el = nodeElsRef.current.get(id);
					if (el === undefined) continue;
					if (Math.abs(o.dx) < 0.4 && Math.abs(o.dy) < 0.4) el.removeAttribute("transform");
					else el.setAttribute("transform", "translate(" + o.dx.toFixed(1) + "," + o.dy.toFixed(1) + ")");
				}
				if (f.hover !== null) {
					const he = nodeElsRef.current.get(f.hover);
					const h = basePos.get(f.hover);
					if (he !== undefined && h !== undefined) {
						const cx = h.x + h.w / 2, cy = h.y + h.h / 2, sc = 1 + 0.08 * f.progress;
						he.setAttribute("transform", "translate(" + cx + "," + cy + ") scale(" + sc.toFixed(3) + ") translate(" + (-cx) + "," + (-cy) + ")");
					}
				}
				for (const rec of edgeElsRef.current.values()) {
					const a = posOf(rec.from);
					const b2 = posOf(rec.to);
					if (a === null || b2 === null) continue;
					rec.el.setAttribute("d", edgeD(a, b2));
				}
			};
			const animateFan = (hoverId) => {
				cancelAnimationFrame(fanRef.current.raf);
				const f = fanRef.current;
				// Leaving: reset the just-hovered node's scale BEFORE nulling — otherwise
				// applyFan stops writing it and it stays stuck at 1.08.
				if (hoverId === null && f.hover !== null) {
					const he = nodeElsRef.current.get(f.hover);
					if (he !== undefined) he.removeAttribute("transform");
				}
				f.hover = hoverId;
				f.from = new Map(f.cur);
				f.to = hoverId === null ? new Map() : fanTargets(hoverId);
				f.t0 = performance.now();
				f.active = true;
				const step = (now) => {
					const t = Math.min(1, (now - f.t0) / f.dur);
					f.progress = 1 - Math.pow(1 - t, 3); // easeOutCubic
					f.cur.clear();
					const ids = new Set([...f.from.keys(), ...f.to.keys()]);
					for (const id of ids) {
						const a = f.from.get(id) || { dx: 0, dy: 0 };
						const b2 = f.to.get(id) || { dx: 0, dy: 0 };
						f.cur.set(id, { dx: a.dx + (b2.dx - a.dx) * f.progress, dy: a.dy + (b2.dy - a.dy) * f.progress });
					}
					applyFan();
					if (t < 1) f.raf = requestAnimationFrame(step);
					else { f.active = false; }
				};
				f.raf = requestAnimationFrame(step);
			};
			// Session flushes re-render the tree while an animation is mid-flight:
			// re-apply the current frame so React's repaint never snaps the fan-out.
			React.useLayoutEffect(() => { if (fanRef.current.active) applyFan(); });

			if (graph.nodes.length === 0) {
				return React.createElement("div", { className: "rb-dag-empty" }, t("rb.dagEmpty"));
			}

			// First paint grows the WHOLE tree from the front to the back (by rank);
			// afterwards only the turns the scrubber newly reveals grow in.
			const allFresh = !mountedRef.current;
			const STAG = 115; // ms per rank step — the wavefront speed

			const edgeEls = [];
			const drawEls = [];
			const dotEls = [];
			let dotIdx = 0;
			for (const edge of graph.edges) {
				if (edge.tIdx >= cut) continue;
				const a = graph.byId.get(edge.from);
				const b = graph.byId.get(edge.to);
				if (a === undefined || b === undefined || a.tIdx >= cut || b.tIdx >= cut) continue;
				const isNew = !seenEdgeKeys.current.has(edge.key);
				seenEdgeKeys.current.add(edge.key);
				const isFresh = (allFresh || edge.tIdx === cut - 1) && isNew;
				const delay = Math.min(1500, (b.rank || 0) * STAG);
				// Lens-consistent hot: an edge is lit when BOTH endpoints are in the
				// cone (was one-hop adj keys — grandparent edges stayed dim while
				// their nodes lit, an inconsistency visible as broken chains).
				const hot = neighborIds !== null && neighborIds.has(edge.from) && neighborIds.has(edge.to);
				const dim = activeEdges !== null && !hot;
				edgeEls.push(React.createElement("path", {
					key: edge.key, d: edge.d,
					ref: (el) => { if (el !== null) edgeElsRef.current.set(edge.key, { el, from: edge.from, to: edge.to }); else edgeElsRef.current.delete(edge.key); },
					className: "rb-edge rb-edge-" + edge.kind + (hot ? " rb-edge-hot" : "") + (dim ? " rb-edge-dim" : "") + (isFresh ? " rb-edge-in" : ""),
					style: isFresh ? { animationDelay: (delay + 380) + "ms" } : undefined,
					markerEnd: (edge.kind === "cochange" || edge.kind === "gitline") ? undefined : "url(#rb-arrow" + (edge.kind === "consume" ? "-consume" : edge.kind === "ran" || edge.kind === "edit" ? "-agent" : edge.kind === "gitfile" ? "-git" : edge.kind === "attach" ? "-dot" : "") + ")",
				},
					React.createElement("title", null, t("rb.ek." + edge.kind)),
				));
				// The growing tip: a line that DRAWN itself from producer to artifact
				// (pathLength=1 → dashoffset 1→0), then hands over to the dashed flow edge.
				if (isFresh && drawEls.length < 48) {
					drawEls.push(React.createElement("path", {
						key: edge.key + "-draw", d: edge.d, pathLength: 1,
						className: "rb-edge-draw rb-edge-draw-" + edge.kind,
						style: { animationDelay: delay + "ms" },
					}));
				}
				if (!dim && edge.kind === "produce" && dotIdx < 50) {
					dotEls.push(React.createElement("circle", { key: edge.key + "-dot", className: "rb-dot rb-dot-produce" + (isFresh ? " rb-edge-in" : ""), r: 2.6, style: isFresh ? { animationDelay: (delay + 500) + "ms" } : undefined },
						React.createElement("animateMotion", { dur: (2 + (dotIdx % 4) * 0.45).toFixed(2) + "s", begin: "-" + ((dotIdx % 5) * 0.5).toFixed(2) + "s", repeatCount: "indefinite", path: edge.d })));
					dotIdx++;
				}
			}

			const nodeEls = [];
			for (const node of graph.nodes) {
				const isOut = exiting[node.id] === true && node.tIdx >= cut;
				if (node.tIdx >= cut && !isOut) continue;
				const fresh = allFresh || node.tIdx === cut - 1;
				const dim = neighborIds !== null && !neighborIds.has(node.id);
				const sel = selectedId === node.id;
				const label = node.kind === "stage" ? node.label : (node.label.length > 15 ? node.label.slice(0, 14) + "…" : node.label);
				const style = { transformOrigin: node.origin };
				if (fresh) style.animationDelay = Math.min(1500, (node.rank || 0) * STAG + 260) + "ms";
				nodeEls.push(React.createElement("g", {
					key: node.id,
					className: "rb-node" + (isOut ? " rb-node-out" : " rb-node-pop") + (dim ? " rb-node-dim" : "") + (sel ? " rb-node-sel" : "") + (node.shelf === true ? " rb-node-shelf" : ""),
					style,
					ref: (el) => { if (el !== null) nodeElsRef.current.set(node.id, el); else nodeElsRef.current.delete(node.id); },
					onMouseEnter: () => { setHoverId(node.id); animateFan(node.id); if (node.kind === "stage") setBloomId(node.id.slice("stage:".length)); },
					onMouseLeave: () => { setHoverId((h) => (h === node.id ? null : h)); animateFan(null); if (node.kind === "stage") setBloomId((b2) => (b2 === node.id.slice("stage:".length) ? null : b2)); },
					onClick: (e) => { e.stopPropagation(); setSelectedId((s) => (s === node.id ? null : node.id)); },
				},
					fresh ? React.createElement("rect", { x: node.x - 3, y: node.y - 3, width: node.w + 6, height: node.h + 6, rx: 10, className: "rb-halo", style: { stroke: "var(--dsw-alias-state-business-primary,#2563eb)", animationDelay: style.animationDelay } }) : null,
					React.createElement("rect", { x: node.x, y: node.y, width: node.w, height: node.h, rx: node.kind === "stage" ? 10 : 8, className: "rb-node-rect rb-node-rect-" + node.kind }),
					node.kind === "stage" ? React.createElement("text", { x: node.x + 12, y: node.y + 20, className: "rb-node-stage-label", title: node.path }, node.label.length > 30 ? node.label.slice(0, 29) + "…" : node.label) : null,
					node.kind === "stage" ? React.createElement("text", { x: node.x + 12, y: node.y + 38, className: "rb-node-stage-sub" }, node.label.length > 30 ? node.label.slice(30, 74) : "") : null,
					node.kind === "stage" ? React.createElement(StageBadge, { status: node.stageStatus, x: node.x + node.w - 14, y: node.y + 16 }) : null,
					node.kind !== "stage" ? React.createElement("text", { x: node.x + 10, y: node.y + node.h / 2 + 3, className: "rb-node-glyph rb-node-glyph-" + node.kind }, glyphOf(node)) : null,
					node.kind !== "stage" ? React.createElement("text", { x: node.x + 38, y: node.y + node.h / 2 + 4, className: node.kind === "ghost" ? "rb-node-label rb-node-label-ghost" : "rb-node-label", title: node.path }, label) : null,
					isRunnable(node.path) ? React.createElement("text", { x: node.x + node.w - 16, y: node.y + node.h / 2 + 4, className: "rb-node-run" }, "▶") : null,
				node.kind !== "commit" && node.kind !== "agent" && node.kind !== "stage" && node.kind !== "ghost" ? React.createElement("g", { key: "acts", className: "rb-node-acts" },
					["👁", isRunnable(node.path) ? "▶" : null, "✨"].filter((x) => x !== null).map((chip, ci) => React.createElement("g", {
						key: chip, className: "rb-node-act",
						transform: "translate(" + (node.x + node.w - 22 * (3 - ci)) + "," + (node.y - 22) + ")",
						onClick: (e) => {
							e.stopPropagation();
							if (chip === "👁") { setSelectedId(node.id); return; }
							if (chip === "▶") { if (runScript) runScript(node.path); return; }
							setSelectedId(node.id);
							runExplain(node);
						},
					},
						React.createElement("rect", { x: 0, y: 0, width: 20, height: 20, rx: 6 }),
						React.createElement("text", { x: 10, y: 14, textAnchor: "middle" }, chip),
					)),
				) : null,
				));
			}
			mountedRef.current = true;

			// Slider track background: filled up to the thumb + a tick at every chapter turn.
			const pct = maxIdx === 0 ? 100 : (cut / maxIdx) * 100;
			const stops = ["var(--dsw-alias-state-business-primary,#2563eb) " + pct + "%", "var(--dsw-alias-border-l2) " + pct + "%"];
			for (const c of eventCuts) {
				const p = Math.round((c / maxIdx) * 1000) / 10;
				if (p <= 0 || p >= 100) continue;
				stops.push("transparent " + (p - 1) + "%", "rgba(255,255,255,.9) " + (p - 1) + "%", "rgba(255,255,255,.9) " + (p + 1) + "%", "transparent " + (p + 1) + "%");
			}
			stops.sort((x, y) => parseFloat(x) - parseFloat(y));

			const curTurnNum = cut > 0 ? timeline.turnOrder[cut - 1] : null;
			const curTurn = curTurnNum === null ? null : timeline.turns.get(curTurnNum);
			const curData = curTurn === null || curTurn === undefined ? null : collectTurnData(curTurn);
			const curTools = curData === null ? [] : summarizeActivity(curData.activity);
			const camTrans = camMode === "none" ? "none" : "transform " + (camMode === "glide" ? "0.72s" : "0.18s") + " cubic-bezier(.25,1,.3,1)";

			return React.createElement(React.Fragment, null,
				React.createElement("div", {
					ref: stageRef, className: "rb-stage", title: t("rb.stageHint"),
					onWheel, onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp, onMouseLeave: onUp,
					onDoubleClick: () => { userMoved.current = false; fit(); },
					onClick: (e) => { if (e.target === e.currentTarget || (typeof e.target.className === "object" && e.target.className.baseVal === undefined && e.target.tagName === "DIV")) setSelectedId(null); },
				},
					React.createElement("svg", {
						viewBox: "0 0 " + graph.width + " " + graph.height,
						className: "rb-svg",
						style: { transform: "translate(" + offset.x + "px," + offset.y + "px) scale(" + scale + ")", transition: camTrans },
						role: "img",
					},
						React.createElement("defs", null,
							React.createElement("marker", { id: "rb-arrow", markerWidth: 9, markerHeight: 9, refX: 7, refY: 4.5, orient: "auto", className: "rb-arrow" }, React.createElement("path", { d: "M 0 0 L 9 4.5 L 0 9 z" })),
							React.createElement("marker", { id: "rb-arrow-consume", markerWidth: 9, markerHeight: 9, refX: 7, refY: 4.5, orient: "auto", className: "rb-arrow-consume" }, React.createElement("path", { d: "M 0 0 L 9 4.5 L 0 9 z" })),
							React.createElement("marker", { id: "rb-arrow-agent", markerWidth: 9, markerHeight: 9, refX: 7, refY: 4.5, orient: "auto", className: "rb-arrow-agent" }, React.createElement("path", { d: "M 0 0 L 9 4.5 L 0 9 z" })),
							React.createElement("marker", { id: "rb-arrow-git", markerWidth: 9, markerHeight: 9, refX: 7, refY: 4.5, orient: "auto", className: "rb-arrow-git" }, React.createElement("path", { d: "M 0 0 L 9 4.5 L 0 9 z" })),
							React.createElement("marker", { id: "rb-arrow-dot", markerWidth: 7, markerHeight: 7, refX: 5, refY: 3.5, orient: "auto", className: "rb-arrow-dot" }, React.createElement("circle", { cx: 3.5, cy: 3.5, r: 2.6 })),
						),
						edgeEls,
						bloomEdges.length > 0 ? React.createElement("g", { key: "rb-bloom" },
							bloomEdges.map((e) => React.createElement("path", {
								key: e.key, d: e.d,
								className: "rb-edge rb-edge-" + e.kind + " rb-edge-bloom",
								ref: (el) => { if (el !== null) edgeElsRef.current.set(e.key, { el, from: e.from, to: e.to }); else edgeElsRef.current.delete(e.key); },
								markerEnd: "url(#rb-arrow" + (e.kind === "consume" ? "-consume" : e.kind === "ran" || e.kind === "edit" ? "-agent" : e.kind === "gitfile" ? "-git" : "") + ")",
							}, React.createElement("title", null, t("rb.ek." + e.kind)))),
						) : null,
						drawEls,
						dotEls,
						graph.shelfY !== undefined ? React.createElement("text", { key: "rb-shelf-title", x: 18, y: graph.shelfY, className: "rb-shelf-label" }, t("rb.shelf")) : null,
						...graph.shelfGroups.map((g) => React.createElement("text", { key: "rb-shelf-g-" + g.y, x: 26, y: g.y + 12, className: "rb-shelf-label", style: { fill: "var(--dsw-alias-label-quaternary,#999)" } }, g.dir)),
						nodeEls,
					),
					backbone !== null && viewMode === "stage" ? React.createElement("div", { key: "rb-pipe-badge", className: "rb-pipe-badge" },
					(backbone.inferred === true ? t("rb.pipeInferred") : t("rb.pipeBadge")) + " · " + backbone.nodes.length + " " + t("rb.stages"),
				) : null,
					React.createElement("div", { key: "rb-legend", className: "rb-legend" },
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "var(--dsw-alias-state-business-primary,#2563eb)", borderStyle: "dashed", borderWidth: "2.4px" } }), t("rb.lgProduce")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "var(--dsw-alias-label-tertiary)" } }), t("rb.lgConsume")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "#7c5cff", borderWidth: "2.2px" } }), t("rb.lgAgent")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "#d4a017", borderWidth: "2.2px" } }), t("rb.lgCommit")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "var(--dsw-alias-label-secondary,#8a8f98)", borderWidth: "2.4px" } }), t("rb.lgAttach")),
					),
					selectedId === null ? null : React.createElement(NodeInspector, {
						node: graph.byId.get(selectedId) || null,
						timeline, openFile, runScript, t,
						explain,
						onExplain: () => { runExplain(graph.byId.get(selectedId) || null); },
						onClose: () => { setSelectedId(null); },
					}),
					graph.shelfCount > 0 ? React.createElement("button", {
						key: "rb-shelfbar", type: "button", className: "rb-shelfbar",
						onClick: () => { setShelfOpen((o) => !o); userMoved.current = false; requestAnimationFrame(() => { requestAnimationFrame(() => fit()); }); },
						title: t("rb.shelfHint"),
					}, "📎 ", t("rb.shelfCount").replace("{n}", String(graph.shelfCount)), " · ", shelfOpen ? t("rb.shelfCollapse") : t("rb.shelfExpand")) : null,
				),
				React.createElement("div", { className: "rb-turnbar" },
					React.createElement("div", { className: "rb-slider-wrap" },
						React.createElement("input", {
							type: "range", min: 0, max: maxIdx, step: 1, value: cut,
							className: "rb-slider", "aria-label": t("rb.turn"),
							style: { background: "linear-gradient(90deg," + stops.join(",") + ")" },
							onChange: (e) => { const v = Number(e.target.value); setCutRaw(v >= maxIdx ? null : v); },
						}),
					),
					React.createElement("span", { className: "rb-turnbar-cut" },
						live ? React.createElement("span", { className: "rb-live" }, t("rb.live")) : null,
						" ",
						curTurnNum === null ? "—" : t("rb.turn") + " " + React.createElement("b", null, String(curTurnNum)),
						" " + cut + "/" + maxIdx,
					),
					React.createElement("span", { className: "rb-turnbar-summary" },
						curData === null ? "" : (curTools.length > 0 ? t("rb.activity") + " " + curTools.join(" · ") : t("rb.noActivity")) + (newAt[cut - 1] > 0 ? " · +" + newAt[cut - 1] : ""),
					),
					React.createElement("button", { type: "button", className: "rb-btn", onClick: () => { userMoved.current = false; fit(); }, title: t("rb.fit") }, "⤢"),
					React.createElement("button", { type: "button", className: "rb-btn", onClick: resetAll, title: t("rb.reset") }, "↺"),
				),
			);
		}

		// Explain can legitimately take ~30s (glm on a long prompt): an inert
		// "explaining…" reads as frozen. A live seconds counter says "working".
		function ExplainLoading(props) {
			const { t } = props;
			const [sec, setSec] = React.useState(0);
			React.useEffect(() => {
				const id = setInterval(() => { setSec((x) => x + 1); }, 1000);
				return () => { clearInterval(id); };
			}, []);
			return React.createElement("span", { className: "rb-explain-muted" }, t("rb.explaining"), " " + sec + "s");
		}

		function NodeInspector(props) {
			const { node, timeline, openFile, runScript, t, onClose, explain, onExplain } = props;
			if (node === null) return null;
			const turn = timeline.turns.get(node.turnNum);
			const data = turn === undefined ? { files: [], reads: [], activity: [], runs: [], model: null } : collectTurnData(turn);
			const actionable = node.kind !== "commit" && node.kind !== "agent" && node.kind !== "stage" && node.kind !== "ghost";
			// NARRATIVE FRAGMENTS: the turns whose tools touched this file carry the
			// human story around it — the user's instruction and the assistant's
			// conclusion, QUOTED from the session log. No LLM, no paraphrase: this is
			// the Jupyter markdown-cell equivalent, recovered by stitching, not generation.
			const frags = [];
			try {
				const base = basename(node.path);
				for (let k = timeline.turnOrder.length - 1; k >= 0 && frags.length < 6; k--) {
					const tn = timeline.turns.get(timeline.turnOrder[k]);
					if (tn === undefined) continue;
					const d = collectTurnData(tn);
					// Association = tool touch OR the file being NAMED in the discussion:
					// the turn that REPORTS results often never touches the file again —
					// its text is the conclusion half of the story ("RMSE 8.94…").
					const uTxt = userNarrOf(timeline.turnOrder[k]);
					const mentioned = (uTxt + "\n" + d.assistantText).includes(base);
					const touched = mentioned
						|| d.files.some((x) => x === node.path || basename(x) === base)
						|| d.reads.some((x) => x === node.path || basename(x) === base)
						|| d.runs.some((r) => r !== null && typeof r === "object" && (r.script === node.path || (Array.isArray(r.inputs) && r.inputs.some((x) => basename(x) === base)) || (Array.isArray(r.outputs) && r.outputs.some((x) => basename(x) === base))));
					if (!touched) continue;
					if (uTxt !== "") frags.push({ turn: timeline.turnOrder[k], who: "you", text: uTxt });
					if (d.assistantText !== "") frags.push({ turn: timeline.turnOrder[k], who: "bot", text: d.assistantText });
				}
			} catch {}
			const meta = [];
			if (node.producedBy !== null) {
				meta.push(React.createElement("div", { key: "pb" }, t("rb.producedBy") + "：", React.createElement("b", null, "▶ " + basename(node.producedBy.scriptPath)), node.producedBy.turnNum === null ? "（" + t("rb.static") + "）" : "（" + t("rb.turn") + " " + node.producedBy.turnNum + "）"));
				const ups = (node.producedBy.inputs || []).map(basename).slice(0, 6);
				meta.push(React.createElement("div", { key: "up" }, t("rb.upstream") + "：" + (ups.length > 0 ? ups.join(", ") : t("rb.none"))));
			} else {
				meta.push(React.createElement("div", { key: "ba" }, t("rb.bornAt") + "：" + t("rb.turn") + " " + node.turnNum));
			}
			if (node.scan === true) {
				meta.push(React.createElement("div", { key: "sc" }, "💾 ", React.createElement("b", null, t("rb.scanBadge"))));
			}
			if (node.kind === "commit") {
				meta.push(React.createElement("div", { key: "cm" }, "📌 ", React.createElement("b", null, t("rb.commitNode"))));
			}
			if (node.kind === "agent") {
				meta.push(React.createElement("div", { key: "ag" }, "🤖 ", React.createElement("b", null, t("rb.agentSession"))));
			}
			if (node.git !== undefined && node.git !== null) {
				const g = node.git;
				const when = g.at > 0 ? " · " + new Date(g.at * 1000).toLocaleString() : "";
				const body = g.dirty === true
					? React.createElement("b", { style: { color: "var(--dsw-alias-state-warn-primary,#e6a23c)" } }, t("rb.gitDirty"))
					: React.createElement("b", null, g.subject.length > 34 ? g.subject.slice(0, 33) + "…" : (g.subject === "" ? "—" : g.subject));
				meta.push(React.createElement("div", { key: "git", title: g.subject }, t("rb.git") + "：", body, when));
			}
			return React.createElement("div", { className: "rb-inspector" },
				React.createElement("div", { className: "rb-insp-head" },
					React.createElement("span", { className: "rb-node-glyph rb-node-glyph-" + node.kind, style: { fontSize: "10px" } }, glyphOf(node)),
					React.createElement("span", { className: "rb-insp-name", title: node.path }, node.label),
					React.createElement("button", { type: "button", className: "rb-insp-close", onClick: onClose, "aria-label": "close" }, "×"),
				),
				React.createElement("div", { className: "rb-insp-path" }, node.path),
				React.createElement("div", { className: "rb-insp-meta" }, meta),
				frags.length > 0 ? React.createElement("div", { key: "narr", className: "rb-narr" },
					React.createElement("div", { className: "rb-narr-title" }, "❝ ", t("rb.narrTitle"), " (" + frags.length + ")"),
					frags.slice(0, 6).map((f, i2) => {
						// Long fragments default to the TAIL: the conclusion ("RMSE 8.94…")
						// sits at the end of a turn, after plans and tool chatter. Native
						// <details> expands to the full quote — zero JS state, immune to
						// re-render churn from live session flushes.
						const clipped = f.text.length > 360;
						const shown = clipped ? "…" + f.text.slice(f.text.length - 560) : f.text;
						return React.createElement("div", { key: "f" + i2, className: "rb-narr-fr rb-narr-" + f.who, title: t("rb.turn") + " " + f.turn },
							React.createElement("span", { className: "rb-narr-who" }, (f.who === "you" ? "👤 " + t("rb.narrYou") : "🤖 " + t("rb.narrBot")) + " · " + t("rb.turn") + " " + f.turn),
							React.createElement("span", { className: "rb-narr-txt" }, shown),
							clipped ? React.createElement("details", { className: "rb-narr-det" },
								React.createElement("summary", null, t("rb.narrFull")),
								React.createElement("span", { className: "rb-narr-txt rb-narr-txtfull" }, f.text),
							) : null,
						);
					}),
				) : null,
				React.createElement("div", { className: "rb-insp-actions" },
					actionable ? React.createElement("button", { type: "button", className: "rb-btn", onClick: () => { previewFile(node.path); } }, "👁 " + t("rb.preview")) : null,
					actionable && isRunnable(node.path) ? React.createElement("button", { type: "button", className: "rb-btn rb-btn-primary", onClick: () => { if (runScript) runScript(node.path); } }, "▶ " + t("rb.run")) : null,
					actionable ? React.createElement("button", { type: "button", className: "rb-btn", onClick: () => { if (openFile) openFile(node.path); } }, "↗ " + t("rb.openSystem")) : null,
					React.createElement("button", { type: "button", className: "rb-btn", disabled: explain.status === "loading", onClick: onExplain }, "✨ " + t("rb.explain")),
				),
				explain.status !== "idle" && explain.key === node.id ? React.createElement("div", { className: "rb-insp-explain" },
					explain.status === "loading" ? React.createElement(ExplainLoading, { t })
						: explain.status === "error" ? React.createElement("span", { className: "rb-explain-err" }, explain.text)
							: explain.text,
				) : null,
			);
		}

		// ---------- runbook view ----------
		// Directory hosting the most captured files: when the session cwd is not a git
		// repo (e.g. the home dir), the artifact CLUSTER points at where the real work
		// happens. Counting per exact dirname (not a shared prefix) avoids collapsing
		// unrelated clusters into an ancestor like /Users/a123.
		// Junk roots never become the workspace: quarantined/trash/prefix paths
		// (a session grepping ~/.Trash/mdc_reset_*/proto for 302 old scripts would
		// otherwise win the density vote and aim the whole runbook at the trash).
		const JUNK_DIR_RE = /\/(\.Trash|node_modules|__pycache__|\.venv|venv|\.cache|\.next|dist|build)\//;
		function densestDir(files) {
			if (!Array.isArray(files) || files.length === 0) return "";
			const counts = new Map();
			for (const p of files) {
				const at = p.lastIndexOf("/");
				if (at <= 0) continue;
				const dir = p.slice(0, at);
				if (JUNK_DIR_RE.test(dir + "/")) continue;
				counts.set(dir, (counts.get(dir) || 0) + 1);
			}
			let best = "";
			let bestCount = 0;
			for (const [dir, count] of counts) {
				if (count > bestCount || (count === bestCount && dir.length > best.length)) { best = dir; bestCount = count; }
			}
			return bestCount >= 2 ? best : "";
		}
		// Fetch the git ledger: try the session cwd first, then the artifact cluster.
		function useGitLedger(cwd, fallbackDir) {
			const [gitData, setGitData] = React.useState(null);
			// A good ledger never downgrades: while paged history replays, the runs
			// briefly vanish and the fallback dir drifts to echo-junk directories —
			// those failed probes must not overwrite an earlier success.
			const bestRef = React.useRef(null);
			React.useEffect(() => {
				let alive = true;
				const probe = async (dir) => {
					try {
						const res = await fetch("agent-git", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: dir }) });
						const j = await res.json();
						if (j !== null && typeof j === "object" && j.ok === true && (typeof j.cwd !== "string" || j.cwd.length === 0)) j.cwd = dir;
						return j !== null && typeof j === "object" ? j : null;
					} catch { return null; }
				};
				(async () => {
					let j = null;
					if (typeof cwd === "string" && cwd.length > 0) j = await probe(cwd);
					if ((j === null || j.ok !== true) && typeof fallbackDir === "string" && fallbackDir.length > 0 && fallbackDir !== cwd) {
						const j2 = await probe(fallbackDir);
						if (j2 !== null && j2.ok === true) j = j2;
					}
					if (j !== null && j.ok === true) bestRef.current = j;
					if (alive) setGitData(bestRef.current !== null ? bestRef.current : j);
				})();
				return () => { alive = false; };
			}, [cwd, fallbackDir]);
			return gitData;
		}

		// Fetch child-agent runs (cross-session handoff) once per child set.
		function useSubruns(childSessions) {
			const [subruns, setSubruns] = React.useState(null);
			const key = React.useMemo(() => JSON.stringify(childSessions()), [childSessions]);
			React.useEffect(() => {
				let ids = [];
				try { ids = JSON.parse(key); } catch { ids = []; }
				if (!Array.isArray(ids) || ids.length === 0) { setSubruns(null); return undefined; }
				let alive = true;
				fetch("agent-subruns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.map((k) => k.id) }) })
					.then((res) => res.json())
					.then((j) => {
						if (!alive || j === null || typeof j !== "object" || j.ok !== true || !Array.isArray(j.sessions)) return;
						const labelOf = new Map(ids.map((k) => [k.id, k.label || ""]));
						setSubruns(j.sessions.map((s) => ({ ...s, label: labelOf.get(s.id) || s.label || "" })));
					})
					.catch(() => {});
				return () => { alive = false; };
			}, [key]);
			return subruns;
		}

		// Durable runs ledger (host /agent-ledger). Timeline runs are flushed once
		// per stable timeline; past entries are read back per workspace. Edges built
		// from it survive compaction and restarts — the timeline forgets, this doesn't.
		function useLedger(dir, timeline, sessionId) {
			const [entries, setEntries] = React.useState(null);
			const flushKey = timeline === null ? "0" : timeline.turnOrder.length + ":" + timeline.turnOrder[timeline.turnOrder.length - 1];
			React.useEffect(() => {
				if (typeof dir !== "string" || dir.length === 0) { setEntries(null); return undefined; }
				let alive = true;
				// Debounced: paged-history replay mutates the timeline every round; without
				// the timer this fires a GET per round (~a dozen requests on open).
				const timer = setTimeout(() => {
					fetch("agent-ledger?dir=" + encodeURIComponent(dir))
						.then((res) => res.json())
						.then((j) => { if (alive && j !== null && typeof j === "object" && j.ok === true && Array.isArray(j.entries)) setEntries(j.entries); })
						.catch(() => {});
				}, 500);
				return () => { alive = false; clearTimeout(timer); };
			}, [dir, flushKey]);
			React.useEffect(() => {
				if (timeline === null || typeof dir !== "string" || dir.length === 0) return undefined;
				const runs = [];
				for (const n of timeline.turnOrder) {
					const turn = timeline.turns.get(n);
					if (turn === undefined) continue;
					for (const r of collectTurnData(turn).runs) {
						if (r === null || typeof r !== "object" || typeof r.script !== "string" || !r.script.startsWith(dir + "/")) continue;
						if (runs.length < 60) runs.push({ kind: "run", script: r.script, inputs: Array.isArray(r.inputs) ? r.inputs.slice(0, 12) : [], outputs: Array.isArray(r.outputs) ? r.outputs.slice(0, 12) : [] });
					}
				}
				if (runs.length === 0) return undefined;
				const timer = setTimeout(() => {
					fetch("agent-ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: runs, sessionId: typeof sessionId === "string" ? sessionId : "", cwd: dir }) }).catch(() => {});
				}, 2500);
				return () => { clearTimeout(timer); };
			}, [dir, flushKey, sessionId]);
			return entries;
		}

		// Workspace scan: the real directory tree, statically analyzed. Fires once
		// per resolved dir (git cwd wins when the workspace is a repo, else the
		// densest captured-files dir) — debounced like the ledger read.
		function useScan(dir, gitData) {
			const [scan, setScan] = React.useState(null);
			const target = gitData !== null && typeof gitData.cwd === "string" && gitData.cwd.length > 0 ? gitData.cwd : dir;
			React.useEffect(() => {
				if (typeof target !== "string" || target.length === 0) { setScan(null); return undefined; }
				let alive = true;
				const timer = setTimeout(() => {
					fetch("agent-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: target }) })
						.then((res) => res.json())
						.then((j) => { if (alive && j !== null && typeof j === "object" && j.ok === true) setScan(j); })
						.catch(() => {});
				}, 400);
				return () => { alive = false; clearTimeout(timer); };
			}, [target]);
			return scan;
		}

		// Pipeline skeleton (host /agent-pipeline): when the workspace carries a
		// hand-curated PIPELINE.md, its mermaid DAG IS the structure a human expects
		// — session archaeology alone can never recover it.
		function usePipeline(dir, gitData) {
			const [pipeline, setPipeline] = React.useState(null);
			const target = gitData !== null && typeof gitData.cwd === "string" && gitData.cwd.length > 0 ? gitData.cwd : dir;
			React.useEffect(() => {
				if (typeof target !== "string" || target.length === 0) { setPipeline(null); return undefined; }
				let alive = true;
				const timer = setTimeout(() => {
					fetch("agent-pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: target }) })
						.then((res) => res.json())
						.then((j) => { if (alive && j !== null && typeof j === "object") setPipeline(j); })
						.catch(() => {});
				}, 300);
				return () => { alive = false; clearTimeout(timer); };
			}, [target]);
			return pipeline;
		}

		function RunbookView(props) {
			const { useSession, openFile, runScript, loadOlder, cwd, childSessions, t } = props;
			knownCwd = typeof cwd === "string" ? cwd : "";
			const subruns = useSubruns(childSessions);
			// Subscribe to the whole conversation snapshot: the timeline reference is
			// stable across location-data publications (turn.data is mutated in place),
			// so selecting only `s.chat.timeline` would never re-render as artifacts
			// stream in during a live turn. Selecting `s` re-renders on every flush.
			const snap = useSession((s) => s);
			const timeline = snap !== null && snap !== undefined && snap.chat !== undefined && snap.chat.timeline !== undefined ? snap.chat.timeline : null;
			// Global override: the runbook is not chained to THIS session's cwd — type
			// any absolute project path and every probe (git/scan/pipeline) retargets.
			const [overrideDir, setOverrideDirState] = React.useState(null);
			React.useEffect(() => {
				try {
					const saved = localStorage.getItem("runbook:override");
					if (saved !== null && saved.length > 0) setOverrideDirState(saved);
				} catch {}
			}, []);
			const setOverrideDir = (v) => {
				setOverrideDirState(v);
				try { if (v === null || v.length === 0) localStorage.removeItem("runbook:override"); else localStorage.setItem("runbook:override", v); } catch {}
			};
			// Session flow is the DEFAULT: it is the spread-out look (yellow git, purple
			// agent, blue produce all visible). "auto" used to silently switch to the
			// backbone ~400ms after open (once PIPELINE.md/scan resolved), flashing a
			// nice layout then collapsing it — exactly the "two systems" the user felt.
			// Backbone is now opt-in via the 主链/backbone button, never automatic.
			const [viewMode, setViewMode] = React.useState("stage");
			// Where the captured files cluster — the git probe fallback directory.
			// Runs come first: their scripts/outputs mark the real workspace, while raw
			// echoed files are often `ls` junk from unrelated directories.
			const fallbackDir = React.useMemo(() => {
				if (timeline === null) return "";
				const runFiles = [];
				const runScripts = [];
				const echoFiles = [];
				for (const n of timeline.turnOrder) {
					const turn = timeline.turns.get(n);
					if (turn === undefined) continue;
					const data = collectTurnData(turn);
					for (const r of data.runs) { if (typeof r.script === "string") runScripts.push(r.script); runFiles.push(r.script, ...r.inputs, ...r.outputs); }
					for (const p of data.files) echoFiles.push(p);
					if (echoFiles.length > 40) break;
				}
				// The FIRST PARSED run's script directory IS the workspace. Raw path
				// bags carry regex junk (".py/.sh" fragments) and env noise
				// (MPLCONFIGDIR=/tmp) — only parseBashRun's script is trustworthy.
				for (const r of runScripts) {
					if (typeof r !== "string" || !r.startsWith("/Users/")) continue;
					if (/\/\./.test(r)) continue; // dot-segments = not a real path
					const at = r.lastIndexOf("/");
					if (at > 0) return r.slice(0, at);
				}
				// Also reject junk roots (node_modules & friends): plugin-dev sessions run
				// scripts inside node_modules/dsh-plugin-runbook/lib — aiming the
				// workspace there starves the graph of everything real.
				const clean = (arr) => arr.filter((p2) => typeof p2 === "string" && p2.startsWith("/Users/") && !/\/\./.test(p2) && !JUNK_DIR_RE.test(p2 + "/"));
				const cands = [];
				for (const r of runScripts) { if (typeof r === "string" && !/\/\./.test(r) && !JUNK_DIR_RE.test(r + "/")) { const at = r.lastIndexOf("/"); if (at > 0) cands.push(r.slice(0, at)); } }
				cands.push(densestDir(clean(runFiles)), densestDir(clean(echoFiles)));
				// First PROJECT-ROOTED candidate wins: /tmp cache noise must never
				// aim the workspace probe away from the real repo.
				for (const c of cands) if (c.startsWith("/Users/")) return c;
				for (const c of cands) if (c !== "") return c;
				return "";
			}, [timeline]);
			const gitData = useGitLedger(overrideDir !== null ? overrideDir : cwd, overrideDir !== null ? null : fallbackDir);
			const effectiveDir = gitData !== null && typeof gitData.cwd === "string" && gitData.cwd.length > 0 ? gitData.cwd : fallbackDir;
			const ledger = useLedger(overrideDir !== null ? "" : fallbackDir, timeline, props.sessionId);
			const scan = useScan(effectiveDir, null);
			const pipeline = usePipeline(effectiveDir, null);
			// Curated PIPELINE.md wins; otherwise the static-IO graph yields a
			// zero-cost inferred backbone (no doc, no API call).
			const backbone = React.useMemo(() => {
				if (pipeline !== null && pipeline.found === true && Array.isArray(pipeline.nodes) && pipeline.nodes.length >= 3) return pipeline;
				return inferPipelineFromScan(scan);
			}, [pipeline, scan]);
			// Header stats are derived in a memo: without it every session flush re-ran
			// collectTurnData over the whole timeline just to count files.
			const stats = React.useMemo(() => {
				let fileCount = 0;
				let scriptCount = 0;
				let runCount = 0;
				if (timeline !== null) {
					for (let i = 0; i < timeline.turnOrder.length; i++) {
						const turn = timeline.turns.get(timeline.turnOrder[i]);
						if (turn === undefined) continue;
						const data = collectTurnData(turn);
						fileCount += data.files.length;
						runCount += data.runs.length;
						for (const p of data.files) if (isRunnable(p)) scriptCount++;
					}
				}
				return { fileCount, scriptCount, runCount };
			}, [timeline]);
			// Auto-pull the paged history on open: the pipeline turns usually sit pages
			// back, and asking the user to click "load older" N times hides the graph.
			// (Stays before the early return — hook order must not depend on data.)
			const hasMore = snap !== null && snap !== undefined && snap.hasMore === true;
			React.useEffect(() => {
				if (!hasMore || loadOlder === undefined) return undefined;
				let alive = true;
				let rounds = 0;
				const step = async () => {
					while (alive && rounds < 40) {
						rounds++;
						try { await loadOlder(); } catch { break; }
						await new Promise((r) => setTimeout(r, 60));
					}
				};
				step();
				return () => { alive = false; };
			}, [hasMore, loadOlder]);
			if (timeline === null || timeline.turnOrder.length === 0) {
				return React.createElement("div", { className: "rb-root" }, React.createElement("div", { className: "rb-empty" }, t("rb.empty")));
			}
			const stat = (label, value) => React.createElement("span", { className: "rb-stat", key: label },
				React.createElement("b", null, String(value)), label);
			return React.createElement("div", { className: "rb-root" },
				React.createElement("div", { className: "rb-header" },
					hasMore && loadOlder ? React.createElement("button", { type: "button", className: "rb-btn", onClick: () => { loadOlder().catch(() => {}); } }, t("rb.loadOlder")) : null,
					React.createElement("span", { className: "rb-header-title" }, t("view.runbook")),
					React.createElement("span", { className: "rb-dirover", title: t("rb.dirHint") },
						React.createElement("input", {
							placeholder: t("rb.dirPlaceholder"), defaultValue: overrideDir === null ? "" : overrideDir,
							onKeyDown: (e) => {
								if (e.key !== "Enter") return;
								const v = e.target.value.trim();
								setOverrideDir(v.length > 0 ? v : null);
							},
							onBlur: (e) => { const v = e.target.value.trim(); if (v !== (overrideDir === null ? "" : overrideDir)) setOverrideDir(v.length > 0 ? v : null); },
						}),
						overrideDir !== null ? React.createElement("button", { type: "button", className: "rb-btn", title: t("rb.dirAuto"), onClick: (e) => { setOverrideDir(null); const inp = e.currentTarget.parentElement.querySelector("input"); if (inp !== null) inp.value = ""; } }, "↺") : null,
					),
					React.createElement("span", { className: "rb-viewswitch" },
						React.createElement("button", { type: "button", className: (viewMode === "stage" ? "rb-vs-on" : ""), onClick: () => { setViewMode("stage"); }, title: t("rb.vsStageHint") }, t("rb.vsStage")),
						React.createElement("button", { type: "button", className: (viewMode === "flow" ? "rb-vs-on" : ""), onClick: () => { setViewMode("flow"); } }, t("rb.vsFlow")),
					),
					React.createElement("span", { className: "rb-header-stats" },
						stat(t("rb.turns"), timeline.turnOrder.length),
						stat(t("rb.files"), stats.fileCount),
						stat(t("rb.scripts"), stats.scriptCount),
						stat(t("rb.links"), stats.runCount),
						stat(t("rb.git"), gitData !== null && gitData.ok === true ? gitData.commits.length : "—"),
					),
				),
				React.createElement(GraphView, { timeline, gitData, subruns, ledger, scan, backbone, viewMode, openFile, runScript, t }),
			);
		}

		// ---------- lightbox (image) ----------
		function ZoomImage(props) {
			const { path, t } = props;
			const [zoom, setZoom] = React.useState(1);
			const [offset, setOffset] = React.useState({ x: 0, y: 0 });
			const [failed, setFailed] = React.useState(false);
			const drag = React.useRef(null);
			React.useEffect(() => { setZoom(1); setOffset({ x: 0, y: 0 }); setFailed(false); }, [path]);
			const onWheel = (e) => { const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const next = Math.min(8, Math.max(1, zoom * f)); setZoom(next); if (next <= 1) setOffset({ x: 0, y: 0 }); };
			const onDown = (e) => { drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; };
			const onMove = (e) => { if (drag.current === null) return; setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
			const onUp = () => { drag.current = null; };
			const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
			if (failed) {
				return React.createElement("div", { className: "avt-failed" },
					React.createElement("div", null, "⚠ " + t("rb.failed")),
					React.createElement("div", { className: "avt-failed-path" }, path),
				);
			}
			return React.createElement("div", { className: "avt-stage" },
				React.createElement("img", {
					className: "avt-img",
					src: fileUrl(path),
					alt: basename(path),
					draggable: false,
					style: { transform: "translate(" + offset.x + "px, " + offset.y + "px) scale(" + zoom + ")", cursor: zoom > 1 ? "grab" : "zoom-in" },
					onWheel, onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp, onMouseLeave: onUp, onDoubleClick: reset,
					onError: () => { setFailed(true); },
				}),
			);
		}
		function ImageLightbox(props) {
			const state = useImg();
			React.useEffect(() => {
				if (!state.open || typeof window === "undefined") return undefined;
				const onKey = (e) => { if (e.key === "Escape") imgStore.close(); else if (e.key === "ArrowRight") imgStore.move(1); else if (e.key === "ArrowLeft") imgStore.move(-1); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [state.open]);
			if (!state.open) return null;
			const path = state.paths[state.index] || "";
			const multi = state.paths.length > 1;
			return React.createElement("div", { className: "avt-lightbox", onClick: (e) => { if (e.target === e.currentTarget) imgStore.close(); } },
				React.createElement("div", { className: "avt-bar" },
					React.createElement("span", { className: "avt-bar-title", title: path }, basename(path) + (multi ? "  (" + (state.index + 1) + "/" + state.paths.length + ")" : "")),
					React.createElement("span", { className: "avt-bar-actions" },
						multi ? React.createElement("button", { type: "button", className: "avt-btn", onClick: () => { imgStore.move(-1); } }, "‹") : null,
						multi ? React.createElement("button", { type: "button", className: "avt-btn", onClick: () => { imgStore.move(1); } }, "›") : null,
						React.createElement("button", { type: "button", className: "avt-btn", onClick: () => { if (typeof window !== "undefined") window.open(fileUrl(path), "_blank"); } }, props.t("rb.openTab")),
						React.createElement("button", { type: "button", className: "avt-btn avt-btn-close", onClick: () => { imgStore.close(); } }, "×"),
					),
				),
				React.createElement(ZoomImage, { key: path, path, t: props.t }),
				React.createElement("div", { className: "avt-hint" }, props.t("hint")),
			);
		}
		function TextViewer(props) {
			const state = useTxt();
			React.useEffect(() => {
				if (!state.open || typeof window === "undefined") return undefined;
				const onKey = (e) => { if (e.key === "Escape") txtStore.close(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [state.open]);
			if (!state.open) return null;
			return React.createElement("div", { className: "avt-lightbox", onClick: (e) => { if (e.target === e.currentTarget) txtStore.close(); } },
				React.createElement("div", { className: "avt-bar" },
					React.createElement("span", { className: "avt-bar-title", title: state.path }, basename(state.path)),
					React.createElement("span", { className: "avt-bar-actions" },
						React.createElement("button", { type: "button", className: "avt-btn", onClick: () => { if (typeof window !== "undefined") window.open(fileUrl(state.path), "_blank"); } }, props.t("rb.openTab")),
						React.createElement("button", { type: "button", className: "avt-btn avt-btn-close", onClick: () => { txtStore.close(); } }, "×"),
					),
				),
				React.createElement("pre", { className: "avt-textwrap" }, state.error ? ("⚠ " + state.error + "\n" + state.path) : (state.loading ? props.t("rb.loading") : state.text)),
			);
		}
		function RunOverlay(props) {
			const state = useRun();
			const [min, setMin] = React.useState(false);
			React.useEffect(() => {
				if (!state.open || typeof window === "undefined") return undefined;
				const onKey = (e) => { if (e.key === "Escape") runStore.close(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [state.open]);
			React.useEffect(() => { if (state.open) setMin(false); }, [state.path, state.open]);
			if (!state.open) return null;
			const code = state.exitCode;
			const badge = state.running ? props.t("rb.running") : code === null ? (state.error ? "✕" : "—") : (code === 0 ? "✓ exit " + code : "✕ exit " + code);
			const body = state.error
				? "⚠ " + state.error + "\n\n" + state.path
				: (state.stderr ? "STDERR\n" + state.stderr + "\n" : "") + (state.stdout || (state.running ? props.t("rb.running") + "…" : "(no output)"));
			// Mini terminal: a corner card, NOT a fullscreen takeover — rerunning a
			// script must not kidnap the page. Minimizes to its title bar.
			return React.createElement("div", { className: "rb-runcard" + (min ? " min" : "") },
				React.createElement("div", { className: "rb-runcard-head" },
					React.createElement("span", { className: "avt-bar-title", title: state.path }, "▶ " + basename(state.path) + "  ",
						React.createElement("span", { className: state.running ? "" : code === 0 ? "rb-runexit-ok" : "rb-runexit-bad" }, badge),
					),
					React.createElement("span", { className: "avt-bar-actions" },
						React.createElement("button", { type: "button", className: "avt-btn", disabled: state.running, onClick: () => { if (typeof window !== "undefined") window.open(fileUrl(state.path), "_blank"); } }, props.t("rb.openTab")),
						React.createElement("button", { type: "button", className: "avt-btn", onClick: () => { setMin((m) => !m); }, title: min ? props.t("rb.runExpand") : props.t("rb.runMin") }, min ? "▢" : "▁"),
						React.createElement("button", { type: "button", className: "avt-btn avt-btn-close", onClick: () => { runStore.close(); } }, "×"),
					),
				),
				min ? null : React.createElement("pre", { className: "rb-runcard-body" + (state.error || (state.stderr !== "" && state.stdout === "") ? " err" : "") }, body),
			);
		}

		// ---------- registrations ----------
		const inject = ["slots", "conversationEvents", "locale", "sessions", "workspaces"];
		function apply(ctx) {
			ctx.conversationEvents.register(artifactDefinition);
			ctx.effect(() => ctx.locale.register(NS, dicts), "dsh-plugin-runbook: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("conversation.view", () => ctx.slots.register(
				{
					name: "conversation.view",
					id: "runbook",
					order: 5,
					locale: NS,
					label: () => t("view.runbook"),
					inject: (sessionId) => ({
						cwd: (() => {
							try {
								const row = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().byId[sessionId] : undefined;
								return row && typeof row.cwd === "string" ? row.cwd : "";
							} catch { return ""; }
						})(),
						childSessions: () => {
							try {
								const snap2 = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : null;
								const byId = snap2 && snap2.byId ? snap2.byId : {};
								return Object.values(byId).filter((s) => s !== undefined && s !== null && s.origin === "subagent" && s.parentId === sessionId)
									.map((s) => ({ id: s.id, label: s.displayTitle || "" }));
							} catch { return []; }
						},
						openFile: (path) => { ctx.workspaces.openPath(path).catch(() => {}); },
						runScript: (path) => {
							let cwd = "";
							try {
								const row = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot().byId[sessionId] : undefined;
								cwd = row && typeof row.cwd === "string" ? row.cwd : "";
							} catch {}
							runStore.open(path, cwd);
						},
						loadOlder: async () => {
							const session = ctx.sessions && ctx.sessions.binding ? ctx.sessions.binding(sessionId)?.session : undefined;
							if (session === undefined) return false;
							await session.loadOlder();
							return true;
						},
					}),
				},
				(props) => React.createElement(RunbookView, { useSession: props.useSession, sessionId: props.sessionId, cwd: props.cwd, childSessions: props.childSessions, openFile: props.openFile, runScript: props.runScript, loadOlder: props.loadOlder, t }),
			));
			ctx.slots.inject("shell.overlay", () => {
				ctx.slots.register(
					{ name: "shell.overlay", id: "runbook-image", order: 50, label: "runbook-image" },
					() => React.createElement(ImageLightbox, { t }),
				);
				ctx.slots.register(
					{ name: "shell.overlay", id: "runbook-text", order: 51, label: "runbook-text" },
					() => React.createElement(TextViewer, { t }),
				);
				ctx.slots.register(
					{ name: "shell.overlay", id: "runbook-run", order: 52, label: "runbook-run" },
					() => React.createElement(RunOverlay, { t }),
				);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
