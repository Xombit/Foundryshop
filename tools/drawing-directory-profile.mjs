const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Measures native sidebar work without suppressing it or changing document sources. */
export async function profileDrawingDirectory({ trials = 5 } = {}) {
	if (!game.user.isGM || !canvas.ready || !canvas.drawings.active || canvas.drawings.controlled.length
		|| !Number.isInteger(trials) || trials < 1 || trials > 5 || document.visibilityState !== 'visible') {
		throw new Error('Directory profiling requires an idle, deselected GM Drawing canvas.');
	}
	const scene = canvas.scene, drawing = canvas.drawings.placeables.at(-1);
	if (!drawing || drawing.document.hidden || drawing.document.locked) throw new Error('An editable Drawing is required.');
	const before = JSON.stringify(scene.toObject());
	const applications = ['placeables', 'drawings-tab'].map(id => foundry.applications.instances.get(id));
	if (applications.some(app => !app)) throw new Error('Native placeable directory applications are unavailable.');
	const samples = [], saved = [], pending = new Set(), failures = [];
	let mode;
	const drain = async () => {
		for (let i = 0; pending.size && i < 10; i++) await Promise.all([...pending]);
		if (pending.size) throw new Error('Directory renders did not settle within the bounded drain.');
		if (failures.length) throw new AggregateError(failures, 'Native directory rendering failed during profiling.');
	};
	try {
		for (const app of applications) {
			for (const name of ['render', '_prepareDirectoryContext', '_renderHTML', '_replaceHTML', '_onRender', '_applyFilters']) {
				if (typeof app[name] !== 'function') continue;
				const own = Object.getOwnPropertyDescriptor(app, name), original = app[name];
				saved.push({ app, name, own });
				app[name] = function(...args) {
					const start = performance.now(), measuredMode = mode;
					const record = () => samples.push({ mode: measuredMode, application: app.id, method: name,
						ms: performance.now() - start });
					let result;
					try { result = original.apply(this, args); }
					catch (error) { record(); throw error; }
					if (!result || typeof result.then !== 'function') { record(); return result; }
					const timed = result.finally(record);
					pending.add(timed);
					timed.then(() => pending.delete(timed), error => { pending.delete(timed); failures.push(error); });
					return timed;
				};
			}
		}
		const cases = [];
		for (const renderSidebar of [true, false]) {
			mode = renderSidebar ? 'native-sidebar' : 'native-renderSidebar-false';
			const durations = [];
			for (let i = 0; i < trials; i++) {
				if (canvas.scene !== scene || document.visibilityState !== 'visible') throw new Error('Profile context changed.');
				const start = performance.now();
				if (!drawing.control({ releaseOthers: true, renderSidebar })) throw new Error('Native control refused.');
				try {
					drawing.renderFlags.set({ refreshShape: true });
					await frame();
				} finally { drawing.release({ renderSidebar }); }
				await frame();
				await drain();
				durations.push(performance.now() - start);
			}
			cases.push({ mode, trialsMs: durations, medianMs: median(durations) });
		}
		await drain();
		if (JSON.stringify(scene.toObject()) !== before) throw new Error('Scene source changed during directory profiling.');
		return {
			count: scene.drawings.size, sidebarActive: !!ui.placeables.active, hookDebug: !!CONFIG.debug.hooks, cases,
			stages: [...new Set(samples.map(s => `${s.mode}|${s.application}|${s.method}`))].map(key => {
				const [mode, application, method] = key.split('|');
				const values = samples.filter(s => s.mode === mode && s.application === application && s.method === method).map(s => s.ms);
				return { mode, application, method, calls: values.length, medianMs: median(values),
					totalMs: values.reduce((sum, ms) => sum + ms, 0) };
			}),
			disclosure: 'Stage timings are inclusive and overlap; do not add parent/child times. renderSidebar:false is a diagnostic, not a UI fix.',
		};
	} finally {
		if (drawing.controlled) drawing.release({ renderSidebar: false });
		try { await drain(); }
		finally {
			for (const { app, name, own } of saved.reverse()) {
				if (own) Object.defineProperty(app, name, own);
				else delete app[name];
			}
		}
	}
}
