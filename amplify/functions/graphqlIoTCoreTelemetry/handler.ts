import type { Handler } from 'aws-lambda';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/graphqlIoTCoreTelemetry';
import type { Schema } from '../../data/resource';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>({ authMode: 'iam' });

export const handler: Handler = async (event) => {
    console.log('Event:', JSON.stringify(event));

    // Get device from GraphQL API / Devices table
    const { data: device, errors: getErrors } = await client.models.Devices.get({
        device_id: event.device_id,
    });

    // If error getting device, return error
    if (getErrors || !device?.owner) {
        console.log('GetDevice errors:', getErrors);
        return { statusCode: 400, body: JSON.stringify({ errors: getErrors, device }) };
    }
    const deviceName = event.deviceName ?? device.device_id;

    // Create telemetry in GraphQL API / Telemetry table
    const { data: telemetry, errors: createErrors } = await client.models.Telemetry.create({
        device_id: event.device_id,
        timestamp: String(event.timestamp),
        moisture: event.moisture,
        owner: device.owner,
    });

    // If error creating telemetry, return error
    if (createErrors) {
        console.log('CreateTelemetry errors:', createErrors);
        return { statusCode: 400, body: JSON.stringify({ errors: createErrors }) };
    }

    // If webhook is enabled and webhook URL is set
    console.log('Webhook check:', {
        device_id: event.device_id,
        webhook_telemetry_enabled: device.webhook_telemetry_enabled,
        has_url: Boolean(device.webhook_url),
    });

    if (device.webhook_telemetry_enabled === true && device.webhook_url && typeof event.moisture === 'number') {
        console.log('Sending webhook to:', device.webhook_url);
        const msgBody = {
            // content: event.eventType,
            embeds: [
                {
                    title: 'Moisture: ' + event.moisture + '%',
                    description: `**Device:** ${deviceName}\n**Time:** <t:${Math.floor(Date.parse(event.timestamp) / 1000)}:f>`,
                    color: 0x347bd8,
                },
            ],
        };

        // Send webhook
        const response = await fetch(device.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msgBody),
        });

        console.log('Webhook response:', response.status);

        // If webhook response is not 204, return error
        if (response.status !== 204) {
            console.error('Discord webhook error:', response.status, await response.text());
        }
    }

    if (
        device.moisture_alert_enabled === true &&
        device.webhook_url &&
        typeof event.moisture === 'number' &&
        typeof device.moisture_alert_threshold === 'number' &&
        event.moisture < device.moisture_alert_threshold
    ) {
        const response = await fetch(device.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [
                    {
                        title: `Moisture Alert: ${event.moisture}%`,
                        description: `**Device:** ${deviceName}\n**Time:** <t:${Math.floor(Date.parse(event.timestamp) / 1000)}:f>`,
                        color: 0x3587f2,
                    },
                ],
            }),
        });

        console.log('Low moisture alert webhook response:', response.status);
        if (response.status !== 204) {
            console.error('Low moisture alert webhook error:', response.status, await response.text());
        }
    }

    // If telemetry created successfully, return telemetry
    return { statusCode: 200, body: JSON.stringify(telemetry) };
};