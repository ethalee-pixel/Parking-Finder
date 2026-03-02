import { useState, useEffect } from "react";
import {
  subscribeToParkingReports,
  subscribeToMyParkingReports,
  ParkingReport,
} from "../parkingReports";
import { regionToBounds } from "../utils/geo";
import { Region } from "react-native-maps";

export const useParkingReports = (
  visibleRegion: Region,
  uid: string | null,
) => {
  const [cloudReports, setCloudReports] = useState<ParkingReport[]>([]);
  const [myReports, setMyReports] = useState<ParkingReport[]>([]);

  useEffect(() => {
    const bounds = regionToBounds(visibleRegion);

    const unsub = subscribeToParkingReports(
      bounds,
      (reports) => setCloudReports(reports),
      (err) => console.log("Firestore error:", err),
    );

    return unsub;
  }, [visibleRegion]);

  useEffect(() => {
    if (!uid) {
      setMyReports([]);
      return;
    }
    const unsub = subscribeToMyParkingReports(
      (reports) => setMyReports(reports),
      (err) => console.log("My reports error:", err),
    );
    return unsub;
  }, [uid]);

  return { cloudReports, myReports };
};