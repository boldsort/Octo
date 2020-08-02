/**
* Debugger and Profiler
**/

const runContinue = document.getElementById('run-continue')
const debugPanel  = document.getElementById('debugger')

const regNumFormat = {}
function cycleNumFormat(r) {
	const f = ['hex','bin','dec','hex']
	regNumFormat[r] = f[f.indexOf(regNumFormat[r] || 'hex')+1]
	haltBreakpoint()
}

function getLabel(addr,reg,raw) {
	var n = 'hex-font', x = 0
	for (var k in emulator.metadata.labels) {
		var v = emulator.metadata.labels[k]
		if (v > x && v <= addr) { n = k; x = v }
	}
	if (raw) return n
	return '('+n+(x == addr ? '' : ' + '+(addr-x))+')'
}

function dumpRegisters(showV, name) {
	const line = (text, click) => '<span' + (click ? ' onClick="'+click+'"' : '')+'>' + text + '</span><br>'
	const register = (n, v, f) => line(n + ' := ' + numericFormat(v, regNumFormat[n || 'hex']) + ' ' + f(v,n), 'cycleNumFormat(\''+n+'\')')
	const aliases = (addr,reg) => {
		var a = emulator.metadata.aliases
		var r = +('0x'+reg.slice(1))
		var n = Object.keys(a).filter(k => a[k] == r).join(', ')
		return n.length ? '('+n+')' : ''
	}
	return (
		line('tick count: ' + emulator.tickCounter) +
		line('breakpoint: ' + name) +
		register('pc', emulator.pc, getLabel) +
		register('i', emulator.i, getLabel) +
		(showV ? range(16).map(x => register('v'+(x.toString(16).toUpperCase()), emulator.v[x], aliases)).join('') : '') +
		'<br>'
	)
}
function dumpStack() {
	return 'inferred stack trace:<br>' + emulator.r.map(x => hexFormat(x) + getLabel(x) + '<br>').join('') + '<br>'
}
function dumpContext() {
	const dbg = emulator.metadata.dbginfo
	const pcline = dbg.getLine(emulator.pc)
	var memlo = emulator.pc, memhi = emulator.pc
	while (dbg.getLine(memlo - 1) > pcline - 8) memlo--
	while (dbg.getLine(memhi + 1) < pcline + 8) memhi++
	var ind = memlo
	const lines = []
	for (var x = dbg.getLine(memlo); x <= dbg.getLine(memhi); x++) lines.push(x)
	const row = (c,a,d,s) => '<tr'+(c?' class=\'current\'':'')+'><td>'+a+'</td><td>'+d+'</td><td><pre>'+escapeHtml(s)+'</pre></td></tr>'
	const linebytes = x => { var r = ''; while(dbg.getLine(ind) == x) r += hexFormat(emulator.m[ind++]).slice(2) + ' '; return r }
	return (
		'context:<br><table class=\'debug-context\'>' +
			row(false, 'addr', 'data', 'source') +
			lines.filter(x => !dbg.lines[x].match(/^\s*$/)).map(x => {
				const here = dbg.getLine(ind)
				return row(
					here == pcline,
					here != x ? '' : hexFormat(ind).slice(2),
					here != x ? '' : linebytes(x),
					dbg.lines[x]
				)
			}).join('') +
		'</table>'
	)
}
function dumpProfile() {
	const profile = []
	for (var addr = 0; addr < 65536; ) {
		while (emulator.profile_data[addr] == undefined && addr < 65536) addr++
		if (addr > 65535) break

		const head = addr, label = getLabel(addr, 0, true)
		var ticks = 0
		while (emulator.profile_data[addr] != undefined && getLabel(addr, 0, true) == label) {
			ticks += emulator.profile_data[addr]
			addr += 2
		}
		if (addr > 65535) break

		profile.push({
			ticks:   ticks,
			percent: 100.0 * (ticks / emulator.tickCounter),
			calls:   emulator.profile_data[head],
			source:  getLabel(head) + ' + ' + ((addr - 2) - head),
		})
	}
	return (
		'<table class=\'debug-profile\'><tr> <th>ticks</th> <th>time</th> <th>calls</th> <th>source</th> </tr>'+
			profile.sort((a,b) => b.percent - a.percent).slice(0, 20).map(
				x => '<tr><td>'+x.ticks+'</td> <td>'+x.percent.toFixed(2)+'%</td> <td>'+x.calls+'</td> <td>'+x.source+'</td></tr>'
			).join('') +
		'</table>' +
		'<div class=\'debug-profile-results\'>' +
			'<div>Full results:<div>' +
			'<div class=\'debug-profile-full\'>' + JSON.stringify(profile) + '</div>' +
		'</div>'
	)
}

function clearBreakpoint() {
	setVisible(runContinue, false)
	setVisible(debugPanel,  false)
	emulator.breakpoint = false
}

let lastBreakpointName = null
function haltBreakpoint(name) {
	updateMonitor()
	lastBreakpointName = name = name || lastBreakpointName
	setVisible(runContinue, true, 'inline')
	setVisible(debugPanel,  true)
	emulator.breakpoint = true
	debugPanel.innerHTML = dumpRegisters(true, name) + dumpStack() + dumpContext()
}

function haltProfiler(name) {
	updateMonitor()
	setVisible(runContinue, true, 'inline')
	setVisible(debugPanel,  true)
	emulator.breakpoint = true
	debugPanel.innerHTML = dumpRegisters(false, name) + dumpProfile()
}

function haltLinter(desc) {
	updateMonitor()
	setVisible(runContinue, true, 'inline')
	setVisible(debugPanel,  true)
	emulator.breakpoint = true
	debugPanel.innerHTML = dumpRegisters(false, 'linter') + '<div class="debug-lint-message">'+desc+'</div>'
}

/**
* Memory Monitor
**/

let monitoring = false

function updateMonitor() {
	const d = Object.keys(emulator.metadata.monitors).map(name => {
		const m = emulator.metadata.monitors[name]
		const d = emulator.m.slice(m.base, m.base+m.length)
		let s = ''
		for (var x = 0; x < d.length; x++) s+= hexFormat(d[x]) + ' '
		return `<tr><td>${name}</td><td>${s}</td></tr>`
	}).join('')
	document.getElementById('monitor').innerHTML = `
		<table><th>Monitor</th><th>Data</th>${d.length?d:'<tr><td>No monitors registered.</td></tr>'}</table>
	`
}

/**
* Linter
**/

let lintIUndefined
let lintScreenUndefined
let lintScreenClear

function resetLinter() {
	lintIUndefined = true
	lintScreenUndefined = false
	lintScreenClear = true
}

function lint() {
	// decode the next instruction
	const op = (emulator.m[emulator.pc] << 8) | emulator.m[emulator.pc+1]
	const x  = (op & 0x0F00) >> 8
	const y  = (op & 0x00F0) >> 4

	// general bad arguments
	if ((op & 0xF00F) == 0x8006 && x != y) {
		haltLinter(`Attempted <tt>vx &gt;&gt;= vy</tt> where <tt>vx</tt> != <tt>vy</tt>.<br>This behaves differently in SCHIP and CHIP-8.`)
	}
	if ((op & 0xF00F) == 0x800E && x != y) {
		haltLinter(`Attempted <tt>vx &lt;&lt;= vy</tt> where <tt>vx</tt> != <tt>vy</tt>.<br>This behaves differently in SCHIP and CHIP-8.`)
	}
	if ((op & 0xF000) == 0xB000) {
		haltLinter(`Attempted <tt>jump0</tt>.<br>This instruction does not work properly in SCHIP.`)
	}
	if ((op & 0xF0FF) == 0xF030 && emulator.v[x] > 9) {
		haltLinter(`Attempted <tt>bighex</tt> for the digit ${emulator.v[x]}.<br>SCHIP only provides digits 0-9.`)
	}
	if ((op & 0xF0FF) == 0xE09E && emulator.v[x] > 15) {
		haltLinter(`Attempted <tt>if vx -key</tt> where <tt>vx</tt> == ${emulator.v[x]}.<br>Key codes > 15 are not portable.`)
	}
	if ((op & 0xF0FF) == 0xE0A1 && emulator.v[x] > 15) {
		haltLinter(`Attempted <tt>if vx key</tt> where <tt>vx</tt> == ${emulator.v[x]}.<br>Key codes > 15 are not portable.`)
	}

	// memory safety
	if (((op & 0xF000) == 0xA000) || // i := NNN
	    ((op & 0xF0FF) == 0xF029) || // i := hex vx
	    ((op & 0xF0FF) == 0xF030))   // i := bighex vx
	{
		lintIUndefined = false
	}
	if ((op & 0xF0FF) == 0xF033 && lintIUndefined) {
		haltLinter(`Attempted <tt>bcd vx</tt> while i is undefined.<br><tt>load vx</tt> and <tt>save vx</tt> leave i in a non-portable state.`)
	}
	if ((op & 0xF0FF) == 0xF055) {
		if (lintIUndefined) {
			haltLinter(`Attempted <tt>save vx</tt> while i is undefined.<br><tt>load vx</tt> and <tt>save vx</tt> leave i in a non-portable state.`)
		}
		lintIUndefined = true
	}
	if ((op & 0xF0FF) == 0xF065) {
		if (lintIUndefined) {
			haltLinter(`Attempted <tt>load vx</tt> while i is undefined.<br><tt>load vx</tt> and <tt>save vx</tt> leave i in a non-portable state.`)
		}
		lintIUndefined = true
	}

	// drawing
	if ((op & 0xF00F) == 0xD000 && !emulator.hires) {
		haltLinter(`Attempted to draw a 16x16 sprite while in low-resolution mode.<br>This does not work properly in SCHIP.`)
	}
	if (op == 0x00E0) { // clear
		lintScreenUndefined = false
		lintScreenClear     = true
	}
	if (op == 0x00FF || op == 0x00FE) { // hires, lores
		lintScreenUndefined = !lintScreenClear
	}
	if ((op & 0xF000) == 0xD000) {
		lintScreenClear = false // conservatively treat repeated draws as "not clear"
		if (lintScreenUndefined) {
			haltLinter(`Attempted <tt>sprite</tt> after changing resolution without clearing the screen.<br>This behaves unpredictably in SCHIP.`)
		}
	}
	if ((op & 0xFFF0) == 0x00C0 && lintScreenUndefined) { // scroll-down
		haltLinter(`Attempted <tt>scroll-down</tt> after changing resolution without clearing the screen.<br>This behaves unpredictably in SCHIP.`)
	}
	if (op == 0x00FB && lintScreenUndefined) {
		haltLinter(`Attempted <tt>scroll-right</tt> after changing resolution without clearing the screen.<br>This behaves unpredictably in SCHIP.`)
	}
	if (op == 0x00FC && lintScreenUndefined) {
		haltLinter(`Attempted <tt>scroll-left</tt> after changing resolution without clearing the screen.<br>This behaves unpredictably in SCHIP.`)
	}

}
