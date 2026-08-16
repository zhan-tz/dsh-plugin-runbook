/** Client half: Jupyter-like runbook — one living file-flow DAG. Scrub turns, watch the pipeline grow, click any node to preview / run / explain. */
window.__ModuleLoader__.load({
	id: "dsh-plugin-runbook",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
		const TEXT_EXT = ["tex", "txt", "md", "markdown", "py", "csv", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "htm", "css", "scss", "less", "sh", "bash", "zsh", "r", "ipynb", "yml", "yaml", "toml", "ini", "cfg", "c", "cpp", "h", "hpp", "rs", "go", "java", "kt", "sql", "xml"];
		const ALL_EXT = IMAGE_EXT.concat(TEXT_EXT, ["pdf"]);
		const FILE_PATH_RE = new RegExp("(?:\\/Users|\\/home|\\/tmp)\\/[A-Za-z0-9_@%+=:./~-]*?\\.(?:" + ALL_EXT.join("|") + ")(?![A-Za-z0-9])", "g");

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
		const parseBashRun = (raw) => {
			if (typeof raw !== "string" || raw.length === 0) return null;
			let cmd = "";
			try { const o = JSON.parse(raw); if (o !== null && typeof o === "object" && typeof o.command === "string") cmd = o.command; } catch {}
			if (cmd === "") return null;
			const paths = cmd.match(FILE_PATH_RE) || [];
			let script = null;
			const inputs = [];
			for (const rawPath of paths) {
				const p = rawPath.replace(/[.,;:]+$/, "");
				const e = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
				if (script === null && (e === "py" || e === "R" || e === "sh" || e === "bash" || e === "js" || e === "mjs")) script = p;
				else inputs.push(p);
			}
			return script === null ? null : { script, inputs };
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
			".rb-edge-gitfile{stroke:var(--dsw-alias-border-l3);stroke-width:1.2;opacity:.5;}",
			".rb-edge-gitline{stroke:#b8860b;stroke-dasharray:5 5;opacity:.45;}",
			".rb-legend{position:absolute;left:12px;top:12px;display:flex;gap:10px;align-items:center;padding:5px 10px;border-radius:8px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent);border:1px solid var(--dsw-alias-border-l1);font-size:10.5px;color:var(--dsw-alias-label-tertiary);pointer-events:none;backdrop-filter:blur(3px);}",
			".rb-legend-item{display:inline-flex;align-items:center;gap:4px;}",
			".rb-legend-line{display:inline-block;width:16px;height:0;border-top:2.4px dashed;}",
			".rb-node-act{cursor:pointer;}",
			".rb-node-act rect{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);}",
			".rb-node-act:hover rect{stroke:var(--dsw-alias-state-business-primary,#2563eb);}",
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
			".rb-node-dim{opacity:.18;}",
			".rb-node-shelf .rb-node-rect{opacity:.6;}",
			".rb-node-shelf .rb-node-label{fill:var(--dsw-alias-label-secondary);}",
			".rb-node-sel .rb-node-rect{stroke-width:2.2;}",
			".rb-halo{fill:none;stroke-width:2;animation:rb-halo 1.1s ease-out 3;pointer-events:none;}",
			"@keyframes rb-halo{from{opacity:.9;}to{opacity:0;}}",
			".rb-edge{fill:none;stroke-width:2.2;opacity:.85;transition:opacity .15s ease;}",
			".rb-edge-produce{stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-dasharray:10 5;animation:rb-flow .8s linear infinite;}",
			".rb-edge-consume{stroke:var(--dsw-alias-label-tertiary);stroke-dasharray:3 4;animation:rb-flow 1.7s linear infinite;}",
			".rb-edge-ran{stroke:#7c5cff;stroke-dasharray:6 4;animation:rb-flow 1.2s linear infinite;}",
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
			".rb-edge-flow{stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:2.4;opacity:.8;fill:none;}",
			".rb-edge-flowlabel{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-rect-ghost{fill:none;stroke:var(--dsw-alias-border-l3);stroke-dasharray:3 3;}",
			".rb-node-rect-stage{fill:color-mix(in srgb, var(--dsw-alias-state-business-primary,#2563eb) 8%, var(--dsw-alias-bg-layer-1));stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:1.6;}",
			".rb-node-stage-label{font-size:12.5px;font-weight:650;fill:var(--dsw-alias-label-primary);}",
			".rb-node-stage-sub{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-label-ghost{fill:var(--dsw-alias-label-quaternary,#999);}",
			".rb-edge-flow{stroke:var(--dsw-alias-state-business-primary,#2563eb);stroke-width:2.4;opacity:.8;}",
			".rb-edge-attach{stroke:var(--dsw-alias-border-l2);stroke-width:1.2;opacity:.5;stroke-dasharray:2 4;}",
			".rb-edge-flowlabel{font-size:10px;fill:var(--dsw-alias-label-tertiary);}",
			".rb-node-label-ghost{fill:var(--dsw-alias-label-quaternary,#999);}",
			".rb-pipe-badge{position:absolute;left:12px;top:44px;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#2563eb) 10%, transparent);border:1px solid var(--dsw-alias-state-business-primary,#2563eb);color:var(--dsw-alias-label-primary);font-size:11px;pointer-events:none;}",
			".rb-edge-edit{stroke:#7c5cff;opacity:.55;stroke-dasharray:1 4;}",
			".rb-arrow-agent{fill:#7c5cff;}",
			".rb-shelf-label{font-size:10.5px;fill:var(--dsw-alias-label-tertiary);letter-spacing:.04em;}",
			"@keyframes rb-flow{to{stroke-dashoffset:-30;}}",
			".rb-edge-dim{opacity:.05!important;}",
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
				"rb.pipeInferred": "推断主链（零 API，可写 PIPELINE.md 固化）",
				"rb.vsAuto": "自动",
				"rb.vsStage": "主链",
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
				"rb.pipeInferred": "inferred backbone (zero API; write a PIPELINE.md to pin it)",
				"rb.vsAuto": "auto",
				"rb.vsStage": "backbone",
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
		const artifactDefinition = {
			kind: "runbook-artifacts",
			match: (event) => {
				try {
					if (event === null || typeof event !== "object") return null;
					const type = event.type;
					const data = event.data;
					if (data === null || typeof data !== "object" || data.turn === undefined) return null;
					if (type === "turn/start") return { id: String(data.turn), role: "start" };
					if (type === "tool/result" || type === "tool/call" || type === "assistant/message") return { id: String(data.turn), role: "update" };
					return null;
				} catch {
					return null;
				}
			},
			start: (_context, match) => {
				const data = match !== null && typeof match === "object" && match.event !== null && typeof match.event === "object" ? match.event.data : null;
				return { turn: data !== null && data.turn !== undefined ? data.turn : -1, files: [], reads: [], activity: [], runs: [], pendingBash: {}, model: null };
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
								if (p !== null && isCapturedPath(p) && state.files.indexOf(p) < 0) files = state.files.concat([p]);
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
						const found = text.slice(0, SCAN_CAP).match(FILE_PATH_RE);
						if (found === null) return state;
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
					return { kind: "turn", turn: s.turn, key: "runbook-artifacts", value: { files: s.files, reads: s.reads, activity: s.activity, runs: s.runs, model: s.model } };
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
				if (art.model !== undefined && art.model !== null && typeof art.model.provider === "string") model = art.model;
			}
			return { files, reads, activity, runs, model };
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
				for (const f of scan.files) {
					if (nodeMap.size >= 100) break;
					const n = ensure(f.abs, 0);
					if (n !== undefined) n.scan = true;
				}
				for (const sc of Array.isArray(scan.scripts) ? scan.scripts : []) {
					if (sc === null || typeof sc !== "object" || typeof sc.path !== "string") continue;
					const script = nodeMap.get(sc.path);
					if (script === undefined) continue;
					for (const r of Array.isArray(sc.reads) ? sc.reads : []) {
						if (nodeMap.has(r)) addEdge(r, sc.path, "consume", 0);
					}
					for (const w of Array.isArray(sc.writes) ? sc.writes : []) {
						const n = nodeMap.get(w);
						if (n === undefined) continue;
						addEdge(sc.path, w, "produce", 0);
						if (n.producedBy === null) n.producedBy = { scriptPath: sc.path, inputs: (sc.reads || []).slice(), turnNum: null };
					}
				}
			}
			for (const { i, files } of passFiles) {
				// Plain echoed paths are background clutter (mostly `ls` floods): cap them
				// well below the node budget so the pipeline stays the visual center.
				for (const p of files) { if (nodeMap.size >= 60) break; ensure(p, i); }
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
						if (ed === null || typeof ed !== "object" || typeof ed.path !== "string" || !isCapturedPath(ed.path)) continue;
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
					if (nodeMap.size >= 110) return;
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
						if (present.length === 0 || commitCount >= 16 || nodeMap.size >= 118) continue;
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
			const nodes = [...nodeMap.values()].slice(0, 120);
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
			const stageRef = React.useRef(null);
			const dragRef = React.useRef(null);
			const userMoved = React.useRef(false);
			const dimsRef = React.useRef("");

			const graph = React.useMemo(() => {
				const g = buildFileGraph(timeline, gitData, subruns, ledger, scan);
				// One view, two layouts: backbone (curated or inferred) and session
				// flow share this component, so no interaction is ever lost by
				// switching modes.
				const useBackbone = backbone !== null && (viewMode === "stage" || viewMode === "auto");
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
				return { ...laid, byId, adj, neighbors };
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
			const neighborIds = React.useMemo(() => {
				if (activeId === null) return null;
				// Adjacency is pre-baked per layout: one Map lookup instead of an O(E) scan
				// on every hover/selection change.
				const set = new Set(graph.neighbors.get(activeId) || []);
				set.add(activeId);
				return set;
			}, [activeId, graph]);

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
				const isFresh = allFresh || edge.tIdx === cut - 1;
				const delay = Math.min(1500, (b.rank || 0) * STAG);
				const hot = activeEdges !== null && activeEdges.has(edge.key);
				const dim = activeEdges !== null && !hot;
				edgeEls.push(React.createElement("path", {
					key: edge.key, d: edge.d,
					className: "rb-edge rb-edge-" + edge.kind + (hot ? " rb-edge-hot" : "") + (dim ? " rb-edge-dim" : "") + (isFresh ? " rb-edge-in" : ""),
					style: isFresh ? { animationDelay: (delay + 380) + "ms" } : undefined,
					markerEnd: (edge.kind === "cochange" || edge.kind === "gitline" || edge.kind === "attach") ? undefined : "url(#rb-arrow" + (edge.kind === "consume" ? "-consume" : edge.kind === "ran" || edge.kind === "edit" ? "-agent" : "") + ")",
				}));
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
					onMouseEnter: () => { setHoverId(node.id); },
					onMouseLeave: () => { setHoverId((h) => (h === node.id ? null : h)); },
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
				hoverId === node.id && node.kind !== "commit" && node.kind !== "agent" && node.kind !== "stage" && node.kind !== "ghost" ? React.createElement("g", { key: "acts", className: "rb-node-acts" },
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
						),
						edgeEls,
						drawEls,
						dotEls,
						graph.shelfY !== undefined ? React.createElement("text", { key: "rb-shelf-title", x: 18, y: graph.shelfY, className: "rb-shelf-label" }, t("rb.shelf")) : null,
						...graph.shelfGroups.map((g) => React.createElement("text", { key: "rb-shelf-g-" + g.y, x: 26, y: g.y + 12, className: "rb-shelf-label", style: { fill: "var(--dsw-alias-label-quaternary,#999)" } }, g.dir)),
						nodeEls,
					),
					backbone !== null && (viewMode === "stage" || viewMode === "auto") ? React.createElement("div", { key: "rb-pipe-badge", className: "rb-pipe-badge" },
					(backbone.inferred === true ? t("rb.pipeInferred") : t("rb.pipeBadge")) + " · " + backbone.nodes.length + " " + t("rb.stages"),
				) : null,
					React.createElement("div", { key: "rb-legend", className: "rb-legend" },
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "var(--dsw-alias-state-business-primary,#2563eb)" } }), t("rb.lgProduce")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "var(--dsw-alias-label-tertiary)" } }), t("rb.lgConsume")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "#7c5cff" } }), t("rb.lgAgent")),
						React.createElement("span", { className: "rb-legend-item" }, React.createElement("span", { className: "rb-legend-line", style: { borderColor: "#b8860b" } }), t("rb.lgCommit")),
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
		function densestDir(files) {
			if (!Array.isArray(files) || files.length === 0) return "";
			const counts = new Map();
			for (const p of files) {
				const at = p.lastIndexOf("/");
				if (at <= 0) continue;
				const dir = p.slice(0, at);
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
						if (j !== null && typeof j === "object" && j.ok === true) j.cwd = dir; // the graph builder keys file paths by it
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
			const [viewMode, setViewMode] = React.useState("auto");
			// Where the captured files cluster — the git probe fallback directory.
			// Runs come first: their scripts/outputs mark the real workspace, while raw
			// echoed files are often `ls` junk from unrelated directories.
			const fallbackDir = React.useMemo(() => {
				if (timeline === null) return "";
				const runFiles = [];
				const echoFiles = [];
				for (const n of timeline.turnOrder) {
					const turn = timeline.turns.get(n);
					if (turn === undefined) continue;
					const data = collectTurnData(turn);
					for (const r of data.runs) { runFiles.push(r.script, ...r.inputs, ...r.outputs); }
					for (const p of data.files) echoFiles.push(p);
					if (echoFiles.length > 40) break;
				}
				const fromRuns = densestDir(runFiles);
				return fromRuns !== "" ? fromRuns : densestDir(echoFiles);
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
						React.createElement("button", { type: "button", className: (viewMode === "auto" ? "rb-vs-on" : ""), onClick: () => { setViewMode("auto"); } }, t("rb.vsAuto")),
						React.createElement("button", { type: "button", className: (viewMode === "stage" ? "rb-vs-on" : ""), onClick: () => { setViewMode("stage"); } }, t("rb.vsStage")),
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
			React.useEffect(() => {
				if (!state.open || typeof window === "undefined") return undefined;
				const onKey = (e) => { if (e.key === "Escape") runStore.close(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [state.open]);
			if (!state.open) return null;
			const code = state.exitCode;
			const badge = state.running ? props.t("rb.running") : code === null ? (state.error ? "✕" : "—") : (code === 0 ? "✓ " + code : "✕ " + code);
			const body = state.error
				? "⚠ " + state.error + "\n\n" + state.path
				: (state.stderr ? "STDERR\n" + state.stderr + "\n\n" : "") + "STDOUT\n" + (state.stdout || (state.running ? props.t("rb.running") + "…" : "(no output)"));
			return React.createElement("div", { className: "avt-lightbox", onClick: (e) => { if (e.target === e.currentTarget) runStore.close(); } },
				React.createElement("div", { className: "avt-bar" },
					React.createElement("span", { className: "avt-bar-title", title: state.path }, "▶ " + basename(state.path) + "  " + badge),
					React.createElement("span", { className: "avt-bar-actions" },
						React.createElement("button", { type: "button", className: "avt-btn", disabled: state.running, onClick: () => { if (typeof window !== "undefined") window.open(fileUrl(state.path), "_blank"); } }, props.t("rb.openTab")),
						React.createElement("button", { type: "button", className: "avt-btn avt-btn-close", onClick: () => { runStore.close(); } }, "×"),
					),
				),
				React.createElement("pre", { className: "avt-textwrap" }, body),
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
