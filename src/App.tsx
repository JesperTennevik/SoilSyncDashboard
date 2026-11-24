import { useEffect, useState } from "react";
import "./App.css";
import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";

import moment from "moment";
import { Line } from 'react-chartjs-2';

import {
  Badge,
  Button,
  Card,
  Collection,
  Divider,
  Flex,
  useAuthenticator,
  View,
  SelectField,
  TextField,
  SwitchField,
} from '@aws-amplify/ui-react';


import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';


ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const client = generateClient<Schema>();

function readShadow(value: unknown): { measurementInterval?: number } {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed as { measurementInterval?: number } : {};
  } catch {
    return {};
  }
}

function formatDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function App() {

  const { user, signOut } = useAuthenticator();

  const [selectedOption, setSelectedOption] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [newDeviceId, setNewDeviceId] = useState("");
  const [newDeviceType] = useState("esp32");

  const [devices, setDevices] = useState<Array<Schema["Devices"]["type"]>>([]);
  const [telemetries, setTelemetry] = useState<Array<Schema["Telemetry"]["type"]>>([]);
  const [_currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const subscription = client.models.Telemetry.observeQuery().subscribe({
      next: (data) => { setTelemetry([...data.items]) },
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = client.models.Devices.observeQuery().subscribe({
      next: (data) => { setDevices([...data.items]) },
    });
    return () => subscription.unsubscribe();
  }, []);

  // Update current time every 30 seconds to refresh "Last Seen" timestamps
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  function createDevice() {
    if (!newDeviceId) return;
    client.models.Devices.create({
      device_id: newDeviceId,
      owner: user.userId,
      device_type: newDeviceType,
    });
    setNewDeviceId("");
  }

  function deleteDevice(device_id: string) {
    client.models.Devices.delete({ device_id })
  }

  const deviceTelemetries = selectedOption && selectedOption !== "all"
    ? telemetries.filter((telemetry) => telemetry.device_id === selectedOption)
    : telemetries;
  const chartTelemetries = deviceTelemetries.filter((telemetry) => {
    const timestamp = moment(telemetry.timestamp);
    if (!timestamp.isValid()) return false;
    const telemetryDate = timestamp.format("YYYY-MM-DD");
    const hasValidStartDate = moment(startDate, "YYYY-MM-DD", true).isValid();
    const hasValidEndDate = moment(endDate, "YYYY-MM-DD", true).isValid();
    return (!hasValidStartDate || telemetryDate >= startDate) &&
      (!hasValidEndDate || telemetryDate <= endDate);
  });
  const deviceIds = [...new Set(chartTelemetries.map((telemetry) => telemetry.device_id))].sort();
  const chartTimestamps = [...new Set(chartTelemetries.map((telemetry) => telemetry.timestamp))]
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const deviceColors = deviceIds.map((_, index) =>
    `hsl(${(200 + index * 137.508) % 360}, 72%, 42%)`
  );

  const chartOptions = {
    responsive: true,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    stacked: false,
    plugins: {
      title: {
        display: true,
        text: selectedOption && selectedOption !== "all"
          ? selectedOption
          : "Soil moisture by device",
      },
    },
    scales: {
      y: {
        type: 'linear' as const,
        display: true,
        position: 'left' as const,
        title: {
          display: true,
          text: 'Soil moisture (%)',
        },
        ticks: {
          callback: function (value: any) {
            return value + '%';
          }
        }
      }
    },
  };


  const cartData = {
    labels: chartTimestamps.map((timestamp) => moment(timestamp).format("YYYY-MM-DD HH:mm:ss")),
    datasets: deviceIds.map((deviceId, index) => {
      const deviceTelemetry = new Map(
        chartTelemetries
          .filter((telemetry) => telemetry.device_id === deviceId)
          .map((telemetry) => [telemetry.timestamp, telemetry.moisture ?? null] as const)
      );
      const color = deviceColors[index];
      return {
        label: deviceId,
        data: chartTimestamps.map((timestamp) => deviceTelemetry.get(timestamp) ?? null),
        tension: 0.4,
        spanGaps: true,
        borderColor: color,
        backgroundColor: color,
        yAxisID: 'y',
      };
    }),
  };


  return (
    <main>
      <h1>{user?.signInDetails?.loginId}'s Devices</h1>
      <Divider padding="xs" />
      <h3>Devices</h3>
      {
        <>
          <TextField
            className="device-name-input"
            label="Device ID"
            placeholder="Enter device ID"
            value={newDeviceId}
            onChange={(e) => setNewDeviceId(e.target.value)}
          />
          <Button variation="primary" onClick={createDevice}>
            Add Device
          </Button>
        </>
      }

      <Divider padding="xs" />

      <Collection
        items={devices}
        type="list"
        direction="row"
        gap="20px"
        wrap="nowrap"
      >
        {(item, index) => {
          const desired = readShadow(item.shadow_desired).measurementInterval;
          const reported = readShadow(item.shadow_reported).measurementInterval;
          const latestTelemetry = telemetries
            .filter((telemetry) => telemetry.device_id === item.device_id)
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
          return (
            <Card
              key={index}
              borderRadius="medium"
              maxWidth="20rem"
              variation="outlined"
            >

              <View padding="xs">

                <br />
                <Flex>
                  Status:
                  <Badge variation={(item?.status == "connected") ? "success" : "error"} key={item.device_id}>
                    {item?.status ? item?.status.charAt(0).toUpperCase() + String(item?.status).slice(1) : ""}
                  </Badge>
                </Flex>
                <Flex>
                  Last Seen: {latestTelemetry ? moment(latestTelemetry.timestamp).fromNow() : "Never"}
                </Flex>
                <br />
                <Flex>ID: {item.device_id}</Flex>
                <TextField
                  label="Webhook URL"
                  defaultValue={item.webhook_url ?? ""}
                  onBlur={(e) =>
                    client.models.Devices.update({
                      device_id: item.device_id,
                      webhook_url: e.target.value,
                    })
                  }
                />
                <SwitchField
                  label="Webhook telemetry enabled"
                  isChecked={item.webhook_telemetry_enabled === true}
                  onChange={(e) =>
                    client.models.Devices.update({
                      device_id: item.device_id,
                      webhook_telemetry_enabled: e.target.checked,
                    })
                  }
                />
                <SwitchField
                  label="Webhook status enabled"
                  isChecked={item.webhook_status_enabled === true}
                  onChange={(e) =>
                    client.models.Devices.update({
                      device_id: item.device_id,
                      webhook_status_enabled: e.target.checked,
                    })
                  }
                />
                <SwitchField
                  label="Low moisture alert enabled"
                  isChecked={item.moisture_alert_enabled === true}
                  onChange={(e) =>
                    client.models.Devices.update({
                      device_id: item.device_id,
                      moisture_alert_enabled: e.target.checked,
                    })
                  }
                />
                {item.moisture_alert_enabled === true && (
                  <TextField
                    label="Low moisture alert threshold (%)"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    placeholder="Enter a value from 0 to 100"
                    defaultValue={item.moisture_alert_threshold != null ? String(item.moisture_alert_threshold) : ""}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (!value) return;
                      const threshold = Number(value);
                      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) return;
                      client.models.Devices.update({
                        device_id: item.device_id,
                        moisture_alert_threshold: threshold,
                      });
                    }}
                  />
                )}
                {item.device_type === "esp32" && (
                  <>
                    <TextField
                      label="Measurement interval"
                      type="number"
                      min={60}
                      descriptiveText="Minimum 60 seconds"
                      key={`${item.device_id}-${desired ?? ""}-${reported ?? ""}`}
                      defaultValue={desired != null ? String(desired / 1000) : reported != null ? String(reported / 1000) : ""}
                      onBlur={(e) => {
                        const measurementInterval = Number(e.target.value);
                        if (!Number.isInteger(measurementInterval) || measurementInterval < 60) return;
                        client.mutations.UpdateDeviceShadow({
                          device_id: item.device_id,
                          measurementInterval,
                        });
                      }}
                    />
                    <div>Current: {reported != null ? reported / 1000 : "unknown"} seconds</div>
                    {desired !== reported && desired != null && (
                      <div>Pending: {desired / 1000} seconds</div>
                    )}
                  </>
                )}
                <br />
                <Button variation="destructive" isFullWidth onClick={() => deleteDevice(item.device_id)}>
                  Delete
                </Button>
              </View>
            </Card>
          );
        }}
      </Collection>

      <Divider padding="xs" />
      <SelectField
        label="Telemetry"
        descriptiveText="Select a device"
        value={selectedOption}
        onChange={(e) => { setSelectedOption(e.target.value) }}
      >
        <option value="all">All</option>
        {devices.map((device) => (
          <option key={device.device_id} value={device.device_id}>{device.device_id}</option>
        ))}
      </SelectField>

      <Flex>
        <TextField
          label="Start date"
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="YYYY-MM-DD"
          value={startDate}
          onChange={(e) => setStartDate(formatDateInput(e.target.value))}
        />
        <TextField
          label="End date"
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="YYYY-MM-DD"
          value={endDate}
          onChange={(e) => setEndDate(formatDateInput(e.target.value))}
        />
      </Flex>

      <View padding="xs"></View>

      <Line options={chartOptions} data={cartData}></Line>

      <Divider padding="xs" />

      <button onClick={signOut}>Sign out</button>
    </main>
  );
}

export default App;
