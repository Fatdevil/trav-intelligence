import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

const PIPELINE_DIR = path.resolve(process.cwd(), 'pipeline');
const EXEC_OPTS = {
  cwd: PIPELINE_DIR,
  timeout: 300000, // 5 min per steg
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
};

function runScript(script: string, args: string = ''): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const cmd = `python ${script} ${args}`.trim();
    exec(cmd, EXEC_OPTS, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: stdout, error: `${error.message}\n${stderr}` });
      } else {
        resolve({ ok: true, output: stdout });
      }
    });
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const months = body.months || 1;
    const skipAnalysis = body.skipAnalysis || false;

    const results: { step: string; ok: boolean; summary: string }[] = [];

    // === STEG 1: Ingest (hämta data från ATG) ===
    const ingest = await runScript('ingest.py', `--months ${months}`);
    const ingestLines = (ingest.output || '').split('\n').filter(l =>
      l.includes('Lopp tillagda') || l.includes('tillagda') || l.includes('COMPLETE')
    );
    results.push({
      step: 'ingest',
      ok: ingest.ok,
      summary: ingest.ok ? (ingestLines.join('; ') || 'Data hämtad.') : (ingest.error || 'Ingest misslyckades.'),
    });

    // Om ingest misslyckas — avbryt kedjan
    if (!ingest.ok) {
      return NextResponse.json({
        success: false,
        pipeline: results,
        error: ingest.error,
      }, { status: 500 });
    }

    // === STEG 2: Features (beräkna statistik) ===
    if (!skipAnalysis) {
      const features = await runScript('features.py');
      const featLines = (features.output || '').split('\n').filter(l =>
        l.includes('rader') || l.includes('COMPLETE')
      );
      results.push({
        step: 'features',
        ok: features.ok,
        summary: features.ok ? (featLines.join('; ') || 'Features beräknade.') : (features.error || 'Features misslyckades.'),
      });

      // === STEG 2.5: Train (BARA PÅ SÖNDAGAR) ===
      const isSunday = new Date().getDay() === 0;
      if (features.ok && isSunday) {
        const train = await runScript('train.py');
        const trainLines = (train.output || '').split('\n').filter(l =>
          l.includes('DONE') || l.includes('sparad') || l.includes('Log-loss') || l.includes('REPORT')
        );
        results.push({
          step: 'train',
          ok: train.ok,
          summary: train.ok ? (trainLines.join('; ') || 'Modell omtränad.') : (train.error || 'Träning misslyckades.'),
        });
      }

      // === STEG 3: Value (identifiera edge-bets) ===
      if (features.ok) {
        const value = await runScript('value.py');
        const valLines = (value.output || '').split('\n').filter(l =>
          l.includes('ROI') || l.includes('Vinstfrekvens') || l.includes('COMPLETE') || l.includes('Bettade')
        );
        results.push({
          step: 'value',
          ok: value.ok,
          summary: value.ok ? (valLines.join('; ') || 'Edge-analys klar.') : (value.error || 'Value misslyckades.'),
        });
      }
    }

    // Summera
    const allOk = results.every(r => r.ok);
    const summaryText = results.map(r => `${r.ok ? '[OK]' : '[FEL]'} ${r.step}: ${r.summary}`).join('\n');

    return NextResponse.json({
      success: allOk,
      pipeline: results,
      summary: summaryText,
    });

  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Okänt fel i pipelinen.',
    }, { status: 500 });
  }
}
