import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    
    const lat = searchParams.get('lat') || '15.0';  
    const lon = searchParams.get('lon') || '65.0'; 
    const startDate = searchParams.get('start') || '20230101';
    const endDate = searchParams.get('end') || '20230110';

    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,WS10M&community=RE&longitude=${lon}&latitude=${lat}&start=${startDate}&end=${endDate}&format=JSON`;

    try {
        const response = await fetch(url);
        const rawData = await response.json();

        const temperatures = rawData.properties.parameter.T2M;
        const oceanCurrents = rawData.properties.parameter.WS10M; 

        const cleanAudioData = Object.keys(temperatures).map(date => ({
            date: date,
            temperature_celsius: temperatures[date],
            ocean_intensity: oceanCurrents[date] 
        }));

        // Frontend ko batane ke liye ke yeh data 'backend' se aa raha hai
        return NextResponse.json(cleanAudioData, {
             headers: {
                 'x-ejb-data-source': 'backend', 
                 'cache-control': 'no-store'
             }
        });

    } catch (error) {
        return NextResponse.json({ success: false, error: "Failed to fetch", details: error });
    }
}