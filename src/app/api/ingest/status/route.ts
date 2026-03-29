import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// GET /api/ingest/status — Returns last ingest timestamp
export async function GET() {
  try {
    const stampPath = path.resolve(process.cwd(), 'pipeline', 'last_ingest.json');

    if (!fs.existsSync(stampPath)) {
      return NextResponse.json({
        lastIngest: null,
        message: 'Ingen datahämtning har körts ännu.',
      });
    }

    const raw = fs.readFileSync(stampPath, 'utf-8');
    const data = JSON.parse(raw);

    return NextResponse.json({
      lastIngest: data.timestamp,
      racesAdded: data.races_added || 0,
      horsesAdded: data.horses_added || 0,
      startersAdded: data.starters_added || 0,
      monthsFetched: data.months_fetched || 0,
    });
  } catch (error: any) {
    return NextResponse.json({
      lastIngest: null,
      error: error.message,
    }, { status: 500 });
  }
}
