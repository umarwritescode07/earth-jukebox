import { NextResponse } from "next/server";

export async function GET() {
  try {
    // NASA EONET API se live events mangwana
    const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30", {
      cache: "no-store",
    });
    
    if (!res.ok) {
      throw new Error(`NASA API responded with status: ${res.status}`);
    }

    const data = await res.json();

    // Frontend ko sirf yeh 5 cheezein chahiye: title, category, date, latitude, longitude
    const formattedEvents = data.events.flatMap((event: any) => {
      const category = event.categories[0]?.title || "Unknown";
      
      // Kuch events mein multiple coordinates hote hain, hum latest wala lenge
      const latestGeo = event.geometry[event.geometry.length - 1];
      
      // Sirf single point wale events globe par show ho sakte hain
      if (!latestGeo || latestGeo.type !== "Point") return [];

      const [longitude, latitude] = latestGeo.coordinates;

      return {
        title: event.title,
        category: category,
        date: latestGeo.date,
        latitude: latitude,
        longitude: longitude,
      };
    });

    return NextResponse.json(formattedEvents);

  } catch (error) {
    console.error("Failed to fetch events:", error);
    return NextResponse.json({ error: "Failed to load events data" }, { status: 500 });
  }
}