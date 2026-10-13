"""Offline spike 4: estimated metadata, diagnostic gates, and local auditions."""
import argparse
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

SR, HOP = 22050, 256
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
PROFILES = {
    'major': [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    'minor': [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
}


def keys(chroma):
    if np.linalg.norm(chroma - np.mean(chroma)) < 1e-8:
        return []
    scores = []
    for mode, profile in PROFILES.items():
        for root in range(12):
            score = np.corrcoef(chroma, np.roll(profile, root))[0, 1]
            scores.append({'key': f'{NAMES[root]} {mode}', 'correlation': round(float(score), 4)})
    return sorted(scores, key=lambda x: -x['correlation'])[:3]


def grid_diagnostics(beats):
    if len(beats) < 8:
        return None
    beats = np.asarray(beats, dtype=float)
    # Preserve missing beats, rather than treating long gaps as one slow beat.
    period = np.median(np.diff(beats))
    indices = np.r_[0, np.cumsum(np.maximum(1, np.rint(np.diff(beats) / period)))]
    slope, offset = np.polyfit(indices, beats, 1)
    local = []
    for ids in np.array_split(np.arange(len(beats)), 3):
        local.append(float(60 / np.polyfit(indices[ids], beats[ids], 1)[0]))
    # A tracker can change phase or lose count in a breakdown. Accumulating its
    # intervals across that transition biases the tempo and phase of every bar.
    # Seed tempo from short runs, then assign each timestamp directly to the
    # nearest grid beat. Fit only timestamps supporting the opening phase.
    runs = []
    for start in range(0, len(beats) - 7, 16):
        part = beats[start:start + 32]
        ids = np.r_[0, np.cumsum(np.maximum(1, np.rint(np.diff(part) / period)))]
        runs.append(float(np.polyfit(ids, part, 1)[0]))
    candidate_period = float(np.median(runs))
    tolerance = min(.025, candidate_period * .08)
    # Choose the earliest coherent run; later offbeat passages must not redefine
    # the opening phase. This remains a beat anchor, never a detected downbeat.
    for start in range(0, len(beats) - 7, 16):
        part = beats[start:start + 32]
        ids = np.rint((part - part[0]) / candidate_period)
        candidate_offset = float(np.median(part - ids * candidate_period))
        if np.mean(abs(part - (candidate_offset + ids * candidate_period)) < tolerance) < .8:
            continue
        for _ in range(8):
            fitted_ids = np.rint((beats - candidate_offset) / candidate_period)
            errors = beats - (candidate_offset + fitted_ids * candidate_period)
            supported = abs(errors) < tolerance
            if supported.sum() < 8 or np.ptp(fitted_ids[supported]) < 7:
                break
            candidate_period, candidate_offset = np.polyfit(fitted_ids[supported], beats[supported], 1)
        else:
            slope, offset = float(candidate_period), float(candidate_offset)
            # Preserve the source-time location of the anchor, including silence.
            # Avoid a negative extrapolated anchor from small fitting residuals.
            if offset < 0:
                offset += np.ceil(-offset / slope) * slope
        break
    # Retain disagreement with *all* tracker beats in diagnostics. A robust
    # estimate must not hide phase changes or turn an unstable track into a pass.
    fitted_ids = np.rint((beats - offset) / slope)
    residual = beats - (offset + fitted_ids * slope)
    n = max(3, len(beats) // 10)
    return {
        'bpm': float(60 / slope), 'offset_seconds': float(offset),
        'residual_p95_ms': float(np.percentile(abs(residual), 95) * 1000),
        'end_minus_start_residual_ms': float((np.median(residual[-n:]) - np.median(residual[:n])) * 1000),
        'thirds_bpm': local, 'tempo_spread_percent': float(100 * np.ptp(local) / (60 / slope)),
        'supported_beats_fraction': float(np.mean(abs(residual) < .025)),
    }


def align_grid_to_attacks(y, grid, beats):
    """Calibrate spectral tracker phase against repeatable PCM attack starts.

    Keep tracker-fit diagnostics and raw timestamps intact; publish the measured
    correction separately. No universal latency constant or tempo adjustment.
    """
    if not grid:
        return grid
    step = max(1, round(SR / 1000))
    energy = np.mean(y[:len(y) // step * step].reshape(-1, step) ** 2, axis=1)
    smooth = np.convolve(energy, np.ones(3) / 3, mode='same')
    rise = smooth - np.r_[np.zeros(5), smooth[:-5]]
    period, anchor = 60 / grid['bpm'], grid['offset_seconds']
    ids = np.unique(np.rint((np.asarray(beats) - anchor) / period).astype(int))
    early, steep = [], []
    for beat in ids[:64]:
        time = anchor + beat * period
        lo, hi = round((time - .060) * SR / step), round((time + .040) * SR / step)
        if lo < 25 or hi + 20 >= len(energy):
            continue
        values = energy[lo:hi]
        floor, peak = float(np.median(values[:15])), float(values.max())
        hits = np.flatnonzero(values > floor + .02 * (peak - floor))
        if peak > floor * 4 and peak - floor > .0001 and len(hits) and hits[0] > 15:
            early.append((lo + hits[0]) * step / SR - time)
        # For attacks over an audible tail, locate the sharp energy rise and
        # backtrack to its foot. The low-floor route above avoids mistaking a
        # later bass oscillation for the attack in otherwise quiet passages.
        k = lo + int(np.argmax(rise[lo:hi - 15]))
        floor, peak = float(smooth[k - 20:k].min()), float(smooth[k:k + 12].max())
        threshold, start = floor + .1 * (peak - floor), k
        while start > k - 25 and smooth[start - 1] > threshold:
            start -= 1
        if peak > floor * 3 and peak - floor > .0001:
            steep.append(start * step / SR - time)
    for candidates in (early, steep):
        if len(candidates) < 8:
            continue
        values = np.asarray(candidates)
        # Require a repeatable delay; occasional fills/weak attacks cannot move
        # every beat. Prefer the strongest cluster over isolated early crossings.
        counts = np.sum(abs(values[:, None] - values[None, :]) < .006, axis=1)
        center = values[int(np.argmax(counts))]
        support = values[abs(values - center) < .006]
        if len(support) < max(8, .6 * len(values)):
            continue
        correction = float(np.median(support))
        corrected = anchor + correction
        if corrected < 0:
            corrected += np.ceil(-corrected / period) * period
        return {**grid, 'offset_seconds': corrected,
                'tracker_offset_seconds': anchor,
                'attack_phase_correction_seconds': correction,
                'attack_phase_support': len(support)}
    return grid


def estimate(y):
    if len(y) < SR or np.max(abs(y)) < 1e-6:
        return {'grid': None, 'beats_seconds': [], 'keys': [], 'window_keys': [], 'flags': ['silence_or_too_short']}
    onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP, trim=True)
    beats = librosa.frames_to_time(frames, sr=SR, hop_length=HOP)
    grid = align_grid_to_attacks(y, grid_diagnostics(beats), beats)
    chunks = []
    for start in range(0, len(y), 30 * SR):
        part = y[start:start + 30 * SR]
        if len(part) < SR or np.sqrt(np.mean(part**2)) < 1e-5:
            continue
        spectrum = abs(librosa.stft(part, n_fft=4096, hop_length=1024))
        harmonic = librosa.decompose.hpss(spectrum)[0]
        chroma = librosa.feature.chroma_stft(S=harmonic**2, sr=SR, n_fft=4096, hop_length=1024)
        chunks.append((start / SR, np.mean(chroma, axis=1), chroma.shape[1]))
    ranked = keys(np.average([c[1] for c in chunks], axis=0, weights=[c[2] for c in chunks])) if chunks else []
    window_keys = [{'start_seconds': c[0], 'candidates': keys(c[1])} for c in chunks]
    flags = ['metrical_level_and_phase_unverified']
    if not grid:
        flags.append('no_usable_grid')
    elif grid['residual_p95_ms'] > 40 or abs(grid['end_minus_start_residual_ms']) > 30 or grid['tempo_spread_percent'] > 1:
        flags.append('grid_needs_review')
    agreement = sum(bool(w['candidates']) and w['candidates'][0]['key'] == ranked[0]['key'] for w in window_keys) / len(window_keys) if ranked else 0
    if not ranked or ranked[0]['correlation'] < .6 or ranked[0]['correlation'] - ranked[1]['correlation'] < .1 or agreement < .7:
        flags.append('ambiguous_key')
    return {'tracker_bpm': float(np.asarray(tempo).flat[0]), 'grid': grid,
            'tempo_alternatives': [grid['bpm'] / 2, grid['bpm'], grid['bpm'] * 2] if grid else [],
            'beats_seconds': beats.tolist(), 'keys': ranked, 'window_keys': window_keys,
            'key_window_agreement': agreement, 'flags': flags}


def checks():
    expected = np.arange(.5, 30, .5)
    y = librosa.clicks(times=expected, sr=SR, length=30 * SR)
    result = estimate(y)
    grid = result['grid']
    predicted = grid['offset_seconds'] + np.arange(80) * 60 / grid['bpm']
    error = np.min(abs(expected[:, None] - predicted[None, :]), axis=1)
    assert np.percentile(error, 95) < .030, error
    assert abs(grid['bpm'] - 120) < 1
    silence = estimate(np.zeros(2 * SR))
    assert silence['grid'] is None and silence['keys'] == []
    changing = np.r_[np.arange(.5, 15, .5), np.arange(15, 30, 60 / 135)]
    changed = estimate(librosa.clicks(times=changing, sr=SR, length=30 * SR))
    assert 'grid_needs_review' in changed['flags'], changed['grid']
    assert keys(np.array(PROFILES['major']))[0]['key'] == 'C major'
    return {'constant_120_bpm_p95_ms': float(np.percentile(error, 95) * 1000),
            'tempo_change_flagged': True, 'silence_rejected': True, 'key_profile_orientation': 'pass',
            'note': 'Synthetic tests verify plumbing, not musical key accuracy.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, default=Path('/music'))
    parser.add_argument('--output', type=Path, default=Path('results/analysis'))
    parser.add_argument('--test-only', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    tested = checks()
    print(json.dumps(tested), flush=True)
    if args.test_only:
        return
    tracks = []
    for path in sorted(args.input.iterdir()):
        if path.suffix.lower() not in {'.mp3', '.wav', '.flac', '.m4a', '.aiff', '.ogg'}:
            continue
        print(f'Analyzing {path.name}', flush=True)
        started = time.monotonic()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'], check=True, capture_output=True)
        y = np.frombuffer(decoded.stdout, dtype='<f4')
        result = estimate(y)
        result.update(name=path.name, sha256=digest, duration_seconds=len(y) / SR, analysis_seconds=time.monotonic() - started, excerpts=[])
        # Local-only audition media. Never commit or distribute the supplied music.
        for label, fraction in [('start', .05), ('middle', .5), ('end', .9)]:
            start = min(max(0, len(y) / SR - 12), len(y) / SR * fraction)
            clip = y[int(start * SR):int((start + 12) * SR)]
            filename = f'{digest[:12]}-{label}.wav'
            media = Path('output/analysis')
            media.mkdir(parents=True, exist_ok=True)
            sf.write(media / filename, clip, SR, subtype='PCM_16')
            result['excerpts'].append({'label': label, 'start_seconds': int(start * SR) / SR, 'url': '../../output/analysis/' + filename})
        tracks.append(result)
        print(f"  {result['grid']} | {result['keys'][:2]}", flush=True)
    if not tracks:
        raise SystemExit('No supported music files found')
    report = {'schema_version': 1, 'engine': f'librosa {librosa.__version__}; HPSS/chroma + Krumhansl-Schmuckler profiles',
              'environment': platform.platform(), 'sample_rate': SR, 'hop_length': HOP,
              'synthetic_checks': tested, 'tracks': tracks, 'human_validation': 'pending'}
    write_report(report, args.output)


def write_report(report, output):
    (output / 'summary.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    template = Path('analysis/review.html').read_text()
    (output / 'review.html').write_text(template.replace('/*REPORT*/', json.dumps(report).replace('<', '\\u003c')))
    rows = ['# Spike 4 — measured results', '', 'Spike COMPLETE (12 October 2026), closed at Paulo’s request. See [closure notes](../../analysis/CLOSURE.md). Automatic estimates; accuracy and correction-time gates remain unverified, deferred product validation.', '',
            '| Song | BPM | Grid residual p95 | Key candidate | Flags |', '|---|---:|---:|---|---|']
    for t in report['tracks']:
        g = t['grid']
        rows.append(f"| {t['name']} | {g['bpm']:.3f} | {g['residual_p95_ms']:.1f} ms | {t['keys'][0]['key'] if t['keys'] else 'unknown'} | {', '.join(t['flags'])} |" if g else f"| {t['name']} | — | — | — | no usable grid |")
    rows += ['', 'Grid residuals measure agreement with detected beats, not annotated ground truth.',
             'See summary.json for whole-track beat timestamps, key alternatives, per-window keys, hashes and container timings.',
             'Open review.html through the documented local server to audition and export manual corrections.', '',
             'Decision: viable as an offline draft-metadata POC. Require editable BPM, phase and key; do not depend on unreviewed automatic metadata.',
             'No engine bake-off, section labels, downbeats, native throughput claim or genre-wide accuracy conclusion.']
    (output / 'REPORT.md').write_text('\n'.join(rows) + '\n')


if __name__ == '__main__':
    main()
