// test/radioVisualizerAudioGraph.test.js
// The Web Audio analyser-graph lifecycle moved out of js/radioVisualizer.js
// into js/radioVisualizer/audioGraph.js. The helpers take the facade as an
// explicit `viz` argument, so they run here against a plain object plus a fake
// AudioContext and stubbed RadioPlayer flags (no jsdom).
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureAudioGraph,
    hasMediaElementSource,
    releaseGraph,
    resumeContext,
    recoverPoisonedGraph
} from '../js/radioVisualizer/audioGraph.js';
import { RadioPlayer } from '../js/radioPlayer.js';

class FakeAnalyser {
    constructor() {
        this.fftSize = 0;
        this.smoothingTimeConstant = 0;
        this.connectedTo = [];
        this.disconnected = 0;
    }
    connect(node) {
        this.connectedTo.push(node);
        return node;
    }
    disconnect() {
        this.disconnected += 1;
    }
}

class FakeSource {
    constructor(mediaElement) {
        this.mediaElement = mediaElement;
        this.connectedTo = [];
        this.disconnected = 0;
    }
    connect(node) {
        this.connectedTo.push(node);
        return node;
    }
    disconnect() {
        this.disconnected += 1;
    }
}

class FakeAudioContext {
    constructor() {
        this.state = 'running';
        this.destination = { name: 'destination' };
        this.resumeCalls = 0;
        this.analysers = [];
        this.sources = [];
        this.throwOnSource = false;
    }
    createAnalyser() {
        const analyser = new FakeAnalyser();
        this.analysers.push(analyser);
        return analyser;
    }
    createMediaElementSource(mediaElement) {
        if (this.throwOnSource) throw new Error('tainted element');
        const source = new FakeSource(mediaElement);
        this.sources.push(source);
        return source;
    }
    resume() {
        this.resumeCalls += 1;
        this.state = 'running';
        return Promise.resolve();
    }
}

function withWindow(AudioContext, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const previous = globalThis.window;
    globalThis.window = AudioContext ? { AudioContext } : {};
    try {
        return fn();
    } finally {
        if (had) globalThis.window = previous;
        else delete globalThis.window;
    }
}

// Awaits the body before restoring, so stubs stay live across `await`s.
async function withRadioPlayer(patch, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(patch)) {
        saved[key] = RadioPlayer[key];
        RadioPlayer[key] = value;
    }
    try {
        return await fn();
    } finally {
        Object.assign(RadioPlayer, saved);
    }
}

/** Minimal stand-in for the RadioVisualizer facade. */
function makeHost(overrides = {}) {
    const calls = { updateStatus: 0, start: 0 };
    const host = {
        calls,
        audioContext: null,
        analyser: null,
        source: null,
        mediaElement: null,
        analysisLive: false,
        analysisBlocked: false,
        enabled: false,
        updateStatus() {
            calls.updateStatus += 1;
        },
        start() {
            calls.start += 1;
        }
    };
    return Object.assign(host, overrides);
}

const corsAudio = (extra = {}) => ({ crossOrigin: 'anonymous', ...extra });

describe('radio visualizer · audio graph attach', () => {
    it('refuses to attach without CORS-safe playback', async () => {
        const host = makeHost({ mediaElement: corsAudio() });
        await withRadioPlayer({ loadedWithCors: false }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(host), false);
            })
        );
        assert.equal(host.audioContext, null, 'no context is created for a tainted stream');
        assert.equal(host.source, null);
    });

    it('refuses an element whose crossOrigin is not anonymous', async () => {
        const host = makeHost({ mediaElement: { crossOrigin: null } });
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(host), false);
            })
        );
        assert.equal(host.source, null);
    });

    it('returns false when there is no media element or no AudioContext', async () => {
        await withRadioPlayer({ loadedWithCors: true, audio: null, getAudioElement: () => null }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(makeHost()), false);
            })
        );
        const host = makeHost({ mediaElement: corsAudio() });
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(null, () => {
                assert.equal(ensureAudioGraph(host), false);
            })
        );
    });

    it('wires source → analyser → destination once', async () => {
        const audio = corsAudio();
        const host = makeHost({ mediaElement: audio });
        let attached;
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(host), true);
                attached = host.audioContext;
            })
        );
        assert.ok(attached instanceof FakeAudioContext);
        assert.equal(host.analyser.fftSize, 2048);
        assert.equal(host.analyser.smoothingTimeConstant, 0.82);
        assert.equal(host.source.mediaElement, audio);
        assert.deepEqual(host.source.connectedTo, [host.analyser]);
        assert.deepEqual(host.analyser.connectedTo, [attached.destination]);
        assert.equal(attached.resumeCalls, 0, 'running context is left alone');
    });

    it('reuses the graph on repeated calls', async () => {
        const host = makeHost({ mediaElement: corsAudio() });
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => {
                ensureAudioGraph(host);
                ensureAudioGraph(host);
            })
        );
        assert.equal(host.audioContext.sources.length, 1);
        assert.equal(host.audioContext.analysers.length, 1);
    });

    it('resumes a suspended context', async () => {
        const ctx = new FakeAudioContext();
        ctx.state = 'suspended';
        const host = makeHost({ mediaElement: corsAudio(), audioContext: ctx });
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => ensureAudioGraph(host))
        );
        assert.equal(ctx.resumeCalls, 1);
    });

    it('drops the previous graph when the media element changes', async () => {
        const staleSource = new FakeSource(corsAudio());
        const staleAnalyser = new FakeAnalyser();
        const ctx = new FakeAudioContext();
        const second = corsAudio();
        const host = makeHost({ mediaElement: second, audioContext: ctx, source: staleSource, analyser: staleAnalyser });

        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(host), true);
            })
        );

        assert.equal(staleSource.disconnected, 1, 'old source detached');
        assert.equal(staleAnalyser.disconnected, 1, 'old analyser detached');
        assert.equal(host.source.mediaElement, second);
        assert.equal(ctx.sources.length, 1);
    });

    it('clears refs when the analyser factory throws', async () => {
        const ctx = new FakeAudioContext();
        ctx.throwOnSource = true;
        const host = makeHost({ mediaElement: corsAudio(), audioContext: ctx });
        await withRadioPlayer({ loadedWithCors: true }, () =>
            withWindow(FakeAudioContext, () => {
                assert.equal(ensureAudioGraph(host), false);
            })
        );
        assert.equal(host.analyser, null);
        assert.equal(host.source, null);
    });
});

describe('radio visualizer · audio graph teardown', () => {
    it('reports whether a media-element source exists', () => {
        assert.equal(hasMediaElementSource(makeHost()), false);
        assert.equal(hasMediaElementSource(makeHost({ source: new FakeSource(null) })), true);
    });

    it('disconnects and clears the graph', () => {
        const source = new FakeSource(null);
        const analyser = new FakeAnalyser();
        const host = makeHost({ source, analyser, mediaElement: corsAudio(), analysisLive: true });

        releaseGraph(host);

        assert.equal(source.disconnected, 1);
        assert.equal(analyser.disconnected, 1);
        assert.equal(host.source, null);
        assert.equal(host.analyser, null);
        assert.equal(host.mediaElement, null);
        assert.equal(host.analysisLive, false);
    });

    it('tolerates an already-empty graph', () => {
        const host = makeHost();
        releaseGraph(host);
        assert.equal(host.source, null);
        assert.equal(host.analyser, null);
    });

    it('resumeContext no-ops without a context', async () => {
        await resumeContext(makeHost());
    });

    it('resumeContext resumes a suspended context', async () => {
        const ctx = new FakeAudioContext();
        ctx.state = 'suspended';
        await resumeContext(makeHost({ audioContext: ctx }));
        assert.equal(ctx.resumeCalls, 1);
    });
});

describe('radio visualizer · poisoned graph recovery', () => {
    it('does nothing without a source, or when playback is already CORS-safe', async () => {
        let marked = 0;
        const markAnalysisCorsFailed = () => { marked += 1; };
        await withRadioPlayer({ markAnalysisCorsFailed, loadedWithCors: false }, async () => {
            assert.equal(await recoverPoisonedGraph(makeHost()), false);
        });
        await withRadioPlayer({ markAnalysisCorsFailed, loadedWithCors: true }, async () => {
            assert.equal(await recoverPoisonedGraph(makeHost({ source: new FakeSource(null) })), false);
        });
        assert.equal(marked, 0);
    });

    it('marks the station, resets audio and leaves the graph released', async () => {
        const fresh = { crossOrigin: 'anonymous' };
        const markCalls = [];
        const host = makeHost({
            source: new FakeSource(null),
            analyser: new FakeAnalyser(),
            mediaElement: corsAudio(),
            analysisLive: true,
            enabled: true
        });

        const result = await withRadioPlayer({
            loadedWithCors: false,
            markAnalysisCorsFailed: () => markCalls.push('mark'),
            resetAudioElementAndPlay: async () => true,
            getAudioElement: () => fresh
        }, () => recoverPoisonedGraph(host));

        assert.equal(result, true);
        assert.deepEqual(markCalls, ['mark']);
        assert.equal(host.analysisBlocked, true);
        assert.equal(host.analysisLive, false);
        assert.equal(host.source, null);
        // Quirk locked in: releaseGraph() clears mediaElement *after* it was
        // refreshed from RadioPlayer, so the host ends up with null.
        assert.equal(host.mediaElement, null);
        assert.equal(host.calls.updateStatus, 1);
        assert.equal(host.calls.start, 1, 'restarts the render loop when it was enabled');
    });

    it('does not restart the loop when the visualizer was closed', async () => {
        const host = makeHost({ source: new FakeSource(null), enabled: false });
        const result = await withRadioPlayer({
            loadedWithCors: false,
            markAnalysisCorsFailed: () => {},
            resetAudioElementAndPlay: async () => false,
            getAudioElement: () => null
        }, () => recoverPoisonedGraph(host));

        assert.equal(result, false, 'passes the reset result through');
        assert.equal(host.calls.start, 0);
        assert.equal(host.calls.updateStatus, 1);
    });
});
