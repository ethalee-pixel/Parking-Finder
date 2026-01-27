import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import MapView, { Region } from "react-native-maps";
import * as Location from "expo-location";

export default function MapScreen() {
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission denied.");
        return;
      }

      const loc = await Location.getCurrentPositionAsync({});
      setRegion({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    })();
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text>{error}</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 8 }}>Getting location…</Text>
      </View>
    );
  }

  return <MapView style={styles.map} initialRegion={region} showsUserLocation />;
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
