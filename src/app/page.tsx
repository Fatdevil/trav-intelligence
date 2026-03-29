"use client";
import { useState, useEffect } from "react";
import TravDashboard from "@/components/dashboard/TravDashboard";
import TravMobile from "@/components/dashboard/TravMobile";

export default function Home() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Förhindrar Next.js Hydration Mismatch genom att inte rendera förrän monteringen bekräftat skärmstorlek
  if (isMobile === null) return <div style={{background: "#0F1117", minHeight: "100vh"}}></div>;

  return isMobile ? <TravMobile /> : <TravDashboard />;
}
