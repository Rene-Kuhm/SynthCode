import React, {useEffect, useMemo, useReducer, useRef} from 'react';
import {Box, Text, render, useApp, useInput, useStdout} from 'ink';

const Focus = Object.freeze({
	loom: 'loom',
	weave: 'weave',
	spool: 'spool',
});

const StitchStatus = Object.freeze({
	idle: 'idle',
	running: 'running',
	ok: 'ok',
	error: 'error',
});

function parseArgs(argv) {
	const args = new Set(argv.slice(2));
	const getValue = name => {
		const prefix = `${name}=`;
		for (const item of args) {
			if (item.startsWith(prefix)) return item.slice(prefix.length);
		}

		return undefined;
	};

	return {
		demo: args.has('--demo'),
		demoTicks: Number(getValue('--demoTicks') ?? 24),
	};
}

function formatStatus(st) {
	switch (st) {
		case StitchStatus.running:
			return {label: 'RUN', color: 'yellow'};
		case StitchStatus.ok:
			return {label: 'OK', color: 'green'};
		case StitchStatus.error:
			return {label: 'ERR', color: 'red'};
		default:
			return {label: 'IDLE', color: 'gray'};
	}
}

function nowStamp() {
	const d = new Date();
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	return `${hh}:${mm}:${ss}`;
}

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}

function wrapToWidth(text, width) {
	if (width <= 4) return [text.slice(0, Math.max(0, width))];
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [''];

	const lines = [];
	let line = '';
	for (const w of words) {
		if (line.length === 0) {
			line = w;
			continue;
		}

		if (line.length + 1 + w.length <= width) {
			line += ` ${w}`;
			continue;
		}

		lines.push(line);
		line = w;
	}

	if (line.length > 0) lines.push(line);
	return lines;
}

function createMockStream({prompt, onToken, onDone}) {
	const script = [
		`[${nowStamp()}] hilo: "${prompt}"`,
		'Analizando el repo…',
		'Detecto puntos de cambio potenciales.',
		'Propongo un plan de 3 pasos.',
		'Generando parches incrementales.',
		'Verificando ejecución (modo demo).',
		'Listo.',
	].join(' ');

	const tokens = script.split(/(\s+)/).filter(Boolean);
	let i = 0;
	const handle = setInterval(() => {
		if (i >= tokens.length) {
			clearInterval(handle);
			onDone?.();
			return;
		}

		onToken(tokens[i]);
		i += 1;
	}, 30);

	return () => clearInterval(handle);
}

const initialState = {
	focus: Focus.weave,
	loomIndex: 0,
	weaveIndex: 0,
	spoolScroll: 0,
	commandMode: false,
	commandInput: '',
	helpOpen: false,
	threads: [
		{name: 'repo', pinned: true},
		{name: 'tarea: interfaz stitch', pinned: true},
		{name: 'idea: runner seguro', pinned: false},
	],
	stitches: [
		{
			title: 'Bienvenida',
			status: StitchStatus.ok,
			timestamp: nowStamp(),
			body: 'Stitch es una TUI donde cada acción es un “punto”: pequeña, revisable y conectada.',
			expanded: true,
		},
		{
			title: 'Crear un hilo',
			status: StitchStatus.idle,
			timestamp: nowStamp(),
			body: 'Pulsa "a" para añadir un hilo. Pulsa "s" para simular un run.',
			expanded: false,
		},
	],
	spool: {
		title: 'Salida',
		lines: ['Pulsa "?" para ayuda. Pulsa ":" para comandos.'],
	},
};

function reducer(state, action) {
	switch (action.type) {
		case 'focus/cycle': {
			const order = [Focus.loom, Focus.weave, Focus.spool];
			const idx = order.indexOf(state.focus);
			const next = order[(idx + 1) % order.length] ?? Focus.weave;
			return {...state, focus: next};
		}

		case 'help/toggle':
			return {...state, helpOpen: !state.helpOpen, commandMode: false};

		case 'command/open':
			return {...state, commandMode: true, helpOpen: false, commandInput: ''};

		case 'command/close':
			return {...state, commandMode: false, commandInput: ''};

		case 'command/input':
			return {...state, commandInput: action.value};

		case 'threads/add': {
			const name = String(action.name ?? '').trim();
			if (name.length === 0) return state;
			return {
				...state,
				threads: [...state.threads, {name, pinned: false}],
				loomIndex: state.threads.length,
			};
		}

		case 'threads/togglePin': {
			const idx = clamp(state.loomIndex, 0, state.threads.length - 1);
			const next = state.threads.map((t, i) => (i === idx ? {...t, pinned: !t.pinned} : t));
			return {...state, threads: next};
		}

		case 'loom/move': {
			const nextIndex = clamp(
				state.loomIndex + action.delta,
				0,
				Math.max(0, state.threads.length - 1),
			);
			return {...state, loomIndex: nextIndex};
		}

		case 'weave/move': {
			const nextIndex = clamp(
				state.weaveIndex + action.delta,
				0,
				Math.max(0, state.stitches.length - 1),
			);
			return {...state, weaveIndex: nextIndex};
		}

		case 'weave/toggleExpand': {
			const idx = clamp(state.weaveIndex, 0, state.stitches.length - 1);
			const next = state.stitches.map((s, i) => (i === idx ? {...s, expanded: !s.expanded} : s));
			return {...state, stitches: next};
		}

		case 'spool/append': {
			const token = String(action.token ?? '');
			if (token.length === 0) return state;

			const last = state.spool.lines.at(-1) ?? '';
			const shouldNewLine = token.includes('\n');
			let lines = state.spool.lines;

			if (shouldNewLine) {
				for (const part of token.split('\n')) {
					lines = [...lines, part];
				}
			} else if (last.length === 0) {
				lines = [...state.spool.lines.slice(0, -1), token];
			} else {
				lines = [...state.spool.lines.slice(0, -1), `${last}${token}`];
			}

			const maxLines = 600;
			if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);

			return {...state, spool: {...state.spool, lines}};
		}

		case 'spool/line': {
			const line = String(action.line ?? '');
			if (line.length === 0) return state;
			const lines = [...state.spool.lines, line];
			return {...state, spool: {...state.spool, lines}};
		}

		case 'stitch/runStart': {
			const title = String(action.title ?? 'Run');
			const next = [
				...state.stitches,
				{
					title,
					status: StitchStatus.running,
					timestamp: nowStamp(),
					body: 'Ejecutando… (streaming)',
					expanded: false,
				},
			];
			return {...state, stitches: next, weaveIndex: next.length - 1};
		}

		case 'stitch/runEnd': {
			const idx = clamp(state.weaveIndex, 0, state.stitches.length - 1);
			const next = state.stitches.map((s, i) =>
				i === idx ? {...s, status: action.ok ? StitchStatus.ok : StitchStatus.error, body: action.body ?? s.body} : s,
			);
			return {...state, stitches: next};
		}

		default:
			return state;
	}
}

function TopBar({state}) {
	const pinned = state.threads.filter(t => t.pinned).length;
	const focusLabel =
		state.commandMode ? 'NEEDLE' : state.helpOpen ? 'HELP' : String(state.focus).toUpperCase();

	return (
		<Box
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
			justifyContent="space-between"
		>
			<Text>
				<Text color="cyanBright">STITCH</Text>
				<Text color="gray"> · </Text>
				<Text color="whiteBright">weave-first</Text>
				<Text color="gray"> · </Text>
				<Text color="magenta">{focusLabel}</Text>
			</Text>
			<Text color="gray">
				pins:{pinned} · {nowStamp()}
			</Text>
		</Box>
	);
}

function Panel({title, active, children}) {
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={active ? 'magentaBright' : 'gray'}
			paddingX={1}
			paddingY={0}
		>
			<Box marginBottom={0}>
				<Text color={active ? 'magentaBright' : 'gray'}>{title}</Text>
			</Box>
			<Box flexGrow={1} flexDirection="column">
				{children}
			</Box>
		</Box>
	);
}

function Loom({state}) {
	return (
		<Panel title="LOOM · hilos" active={state.focus === Focus.loom}>
			{state.threads.map((t, i) => {
				const selected = i === state.loomIndex;
				return (
					<Box key={`${t.name}-${i}`}>
						<Text color={selected ? 'whiteBright' : 'gray'}>
							{selected ? '› ' : '  '}
						</Text>
						<Text color={t.pinned ? 'yellow' : selected ? 'whiteBright' : 'gray'}>
							{t.pinned ? '◆ ' : '◇ '}
							{t.name}
						</Text>
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text color="gray">a: nuevo hilo · espacio: pin</Text>
			</Box>
		</Panel>
	);
}

function Weave({state, width}) {
	const maxText = Math.max(12, width - 6);
	return (
		<Panel title="WEAVE · puntos" active={state.focus === Focus.weave}>
			{state.stitches.map((s, i) => {
				const selected = i === state.weaveIndex;
				const status = formatStatus(s.status);
				const isLast = i === state.stitches.length - 1;
				const rail = isLast ? '└' : '├';
				const stem = isLast ? ' ' : '│';
				const head = `${rail}─`;
				const lines = wrapToWidth(s.body, maxText);

				return (
					<Box key={`${s.title}-${i}`} flexDirection="column">
						<Box>
							<Text color={selected ? 'whiteBright' : 'gray'}>
								{selected ? '›' : ' '}
							</Text>
							<Text color="gray"> {head}</Text>
							<Text color={status.color}>{status.label}</Text>
							<Text color="gray"> · </Text>
							<Text color={selected ? 'whiteBright' : 'gray'}>
								{s.title}
							</Text>
							<Text color="gray"> · {s.timestamp}</Text>
							<Text color="gray"> {s.expanded ? '▾' : '▸'}</Text>
						</Box>
						{s.expanded && (
							<Box>
								<Text color="gray">  {stem}  </Text>
								<Box flexDirection="column">
									{lines.map((ln, idx) => (
										<Text key={idx} color={selected ? 'white' : 'gray'}>
											{ln}
										</Text>
									))}
								</Box>
							</Box>
						)}
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text color="gray">j/k: navegar · enter: expandir · s: run</Text>
			</Box>
		</Panel>
	);
}

function Spool({state}) {
	const lastLines = state.spool.lines.slice(-12);
	return (
		<Panel title="SPOOL · stream" active={state.focus === Focus.spool}>
			<Box flexDirection="column" flexGrow={1}>
				{lastLines.map((ln, idx) => (
					<Text key={idx} color="gray">
						{ln}
					</Text>
				))}
			</Box>
			<Box marginTop={1}>
				<Text color="gray">: comandos · ?: ayuda · tab: foco</Text>
			</Box>
		</Panel>
	);
}

function HelpOverlay() {
	return (
		<Box
			position="absolute"
			top={2}
			left={4}
			right={4}
			borderStyle="double"
			borderColor="cyanBright"
			paddingX={2}
			paddingY={1}
			flexDirection="column"
		>
			<Text color="cyanBright">Ayuda rápida</Text>
			<Text color="gray">tab: cambia de panel · q: salir · ?: cerrar ayuda</Text>
			<Text color="gray">a: añade hilo · espacio: pin/unpin hilo</Text>
			<Text color="gray">j/k: navega en panel activo · enter: expande punto</Text>
			<Text color="gray">s: simula run con streaming · : comandos</Text>
			<Text color="gray">Comandos: help | quit | thread add &lt;nombre&gt; | run | clear</Text>
		</Box>
	);
}

function NeedleBar({state}) {
	return (
		<Box
			borderStyle="round"
			borderColor={state.commandMode ? 'magentaBright' : 'gray'}
			paddingX={1}
		>
			<Text color={state.commandMode ? 'magentaBright' : 'gray'}>
				{state.commandMode ? ':' : ' '}
			</Text>
			<Text color={state.commandMode ? 'whiteBright' : 'gray'}>
				{state.commandMode ? state.commandInput : 'Pulsa ":" para comandos'}
			</Text>
			<Box flexGrow={1} />
			<Text color="gray">
				{state.commandMode ? 'enter: ejecutar · esc: cancelar' : 'q: salir'}
			</Text>
		</Box>
	);
}

function executeCommand(raw, dispatch, {exit}) {
	const cmd = String(raw ?? '').trim();
	if (cmd.length === 0) return;

	const [head, ...rest] = cmd.split(/\s+/);
	if (head === 'quit' || head === 'q' || head === 'exit') {
		exit();
		return;
	}

	if (head === 'help') {
		dispatch({type: 'help/toggle'});
		return;
	}

	if (head === 'clear') {
		dispatch({type: 'spool/line', line: ''});
		dispatch({type: 'spool/line', line: '---'});
		return;
	}

	if (head === 'thread' && rest[0] === 'add') {
		const name = rest.slice(1).join(' ');
		dispatch({type: 'threads/add', name});
		dispatch({type: 'spool/line', line: `[${nowStamp()}] hilo añadido: ${name}`});
		return;
	}

	if (head === 'run') {
		dispatch({type: 'stitch/runStart', title: 'Run (command)'});
		return;
	}

	dispatch({type: 'spool/line', line: `[${nowStamp()}] comando desconocido: ${cmd}`});
}

function App({demo, demoTicks}) {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const [state, dispatch] = useReducer(reducer, initialState);
	const teardownRef = useRef(null);
	const demoRef = useRef({ticks: 0});

	const dims = useMemo(() => {
		const columns = stdout?.columns ?? 120;
		return {columns};
	}, [stdout?.columns]);

	useEffect(() => {
		if (!demo) return;
		const handle = setInterval(() => {
			demoRef.current.ticks += 1;
			if (demoRef.current.ticks === 3) {
				dispatch({type: 'stitch/runStart', title: 'Run (demo)'});
			}
			if (demoRef.current.ticks >= demoTicks) exit();
		}, 60);
		return () => clearInterval(handle);
	}, [demo, demoTicks, exit]);

	useEffect(() => {
		const last = state.stitches[state.stitches.length - 1];
		if (!last || last.status !== StitchStatus.running) return;

		teardownRef.current?.();
		dispatch({type: 'spool/line', line: `[${nowStamp()}] streaming iniciado…`});

		const stop = createMockStream({
			prompt: state.threads[state.loomIndex]?.name ?? 'hilo',
			onToken: token => dispatch({type: 'spool/append', token}),
			onDone: () => {
				dispatch({type: 'spool/line', line: ''});
				dispatch({type: 'spool/line', line: `[${nowStamp()}] streaming finalizado.`});
				dispatch({
					type: 'stitch/runEnd',
					ok: true,
					body: 'Run completo. Listo para conectar un proveedor real.',
				});
			},
		});
		teardownRef.current = stop;
		return () => stop();
	}, [state.stitches.length]);

	useInput((input, key) => {
		if (key.ctrl && input === 'c') exit();

		if (state.helpOpen) {
			if (input === '?' || key.escape) dispatch({type: 'help/toggle'});
			return;
		}

		if (state.commandMode) {
			if (key.escape) {
				dispatch({type: 'command/close'});
				return;
			}

			if (key.return) {
				executeCommand(state.commandInput, dispatch, {exit});
				dispatch({type: 'command/close'});
				return;
			}

			if (key.backspace || key.delete) {
				dispatch({type: 'command/input', value: state.commandInput.slice(0, -1)});
				return;
			}

			if (key.tab) return;
			if (input && !key.ctrl && !key.meta) {
				dispatch({type: 'command/input', value: `${state.commandInput}${input}`});
			}
			return;
		}

		if (input === 'q') exit();
		if (input === '?') dispatch({type: 'help/toggle'});
		if (input === ':') dispatch({type: 'command/open'});
		if (key.tab) dispatch({type: 'focus/cycle'});

		if (input === 's') {
			dispatch({type: 'stitch/runStart', title: 'Run (key)'});
			return;
		}

		const delta =
			input === 'j' || key.downArrow ? 1 : input === 'k' || key.upArrow ? -1 : 0;
		if (delta !== 0) {
			if (state.focus === Focus.loom) dispatch({type: 'loom/move', delta});
			if (state.focus === Focus.weave) dispatch({type: 'weave/move', delta});
			return;
		}

		if (key.return && state.focus === Focus.weave) dispatch({type: 'weave/toggleExpand'});
		if (input === 'a') dispatch({type: 'threads/add', name: `hilo ${state.threads.length + 1}`});
		if (input === ' ' && state.focus === Focus.loom) dispatch({type: 'threads/togglePin'});
	});

	const centerWidth = Math.max(40, Math.floor(dims.columns * 0.46));

	return (
		<Box flexDirection="column" height="100%">
			<TopBar state={state} />
			<Box height={1} />
			<Box flexGrow={1} gap={1}>
				<Box width="26%">
					<Loom state={state} />
				</Box>
				<Box width={centerWidth}>
					<Weave state={state} width={centerWidth} />
				</Box>
				<Box flexGrow={1}>
					<Spool state={state} />
				</Box>
			</Box>
			<Box height={1} />
			<NeedleBar state={state} />
			{state.helpOpen && <HelpOverlay />}
		</Box>
	);
}

const {demo, demoTicks} = parseArgs(process.argv);
render(<App demo={demo} demoTicks={demoTicks} />);
