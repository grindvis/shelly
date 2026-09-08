/**
 * Smart cycle manager for heat pumps
 *
 * PURPOSE
 * Prevent a modulating thermostat from causing the heat pump to
 * short-cycle by coordinating two Shelly devices: one directly
 * switching the heat pump, and one acting as the thermostat input.
 *
 * REQUIREMENTS
 * 1. A (modulating) thermostat that provides ON and OFF relay signals.
 * 2. A Shelly device that supports scripting (e.g., Gen2 relays or newer)
 *    to act as the heat pump switch.
 * 3. A Shelly device able to send webhooks (most models) to act as 
 *    the thermostat switch input.
 * 4. Static IP addresses for both Shelly devices to avoid network issues.
 *
 * BEHAVIOUR / ACCEPTANCE CRITERIA
 * - When the thermostat turns ON, the heat pump must turn ON immediately.
 * - When the thermostat turns OFF, the heat pump remains ON for a configured
 *   hold period (cycle-down time) to avoid short cycles.
 * - If the thermostat turns ON during that hold period, the pending timer
 *   is canceled and the heat pump stays ON.
 * - If the hold period expires, the heat pump turns OFF and a cooldown timer
 *   begins (prevents immediate restart).
 * - If the thermostat turns ON after the hold period but during cooldown,
 *   the heat pump will only switch ON after the cooldown has finished.
 *
 * NOTES
 * - Do not just copy and paste this code; it is provided as a reference and may require
 *   adjustments to work with your specific setup.
 * - Choose the hold and cooldown durations carefully; tuning may take time.
 *   In the author's setup a 10–15 minute hold worked well.
 * - Test changes safely and monitor the heat pump to avoid equipment stress.
 * - This script is written for the following combination of Shelly devices:
 *   - Shelly 1 plus mini to switch the heat pump.
 *   - Shelly UNI (Gen1) to act as the thermostat input (any Shelly relais 
 *     capable of sending webhooks can be used).
 * - There are mjultiple ways to implement this; this is just one approach based on an 
 *   the already installed devices. Ideally the thermostat is based on a Shelly UNI (Gen2) 
 *   with a temperature sensor, running a script to switch the heat pump directly (logic 
 *   in thermostat only).
 */

/**
 * Thermostat webhook configuration:
 * ON: http://192.168.1.20/script/1/thermostat_on
 * OFF: http://192.168.1.20/script/1/thermostat_off
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

let CONFIG = {

  // Relay controlling the heat pump
  switchId: 0,

  // Continue heating after thermostat OFF
  holdTimeSec: 15 * 60,

  // Minimum OFF time before restart
  cooldownTimeSec: 10 * 60,

  debug: true
};

// ============================================================================
// NETWORK
// ============================================================================

let NETWORK = {

  // IP address of this Shelly
  heatPumpShellyIp: "192.168.1.181",

  // Thermostat Shelly (documentation only)
  thermostatShellyIp: "192.168.1.180"
};

// ============================================================================
// STATE
// ============================================================================

let thermostatDemand = false;

let holdTimer = null;
let delayedStartTimer = null;

// Timestamp when cooldown ends (Unix seconds)
let cooldownUntil = 0;

// ============================================================================
// LOGGING
// ============================================================================

function log(msg) {

  if (CONFIG.debug) {
    print("[HP] " + msg);
  }
}

// ============================================================================
// RELAY
// ============================================================================

function relayState() {

  let status =
    Shelly.getComponentStatus(
      "switch:" + CONFIG.switchId
    );

  return status.output;
}

function heatPumpOn() {

  if (relayState()) {
    return;
  }

  Shelly.call(
    "Switch.Set",
    {
      id: CONFIG.switchId,
      on: true
    }
  );

  log("Heat pump ON");
}

function heatPumpOff() {

  if (!relayState()) {
    return;
  }

  Shelly.call(
    "Switch.Set",
    {
      id: CONFIG.switchId,
      on: false
    }
  );

  log("Heat pump OFF");
}

// ============================================================================
// TIMER HELPERS
// ============================================================================

function cancelHoldTimer() {

  if (holdTimer !== null) {

    Timer.clear(holdTimer);
    holdTimer = null;

    log("Hold timer cancelled");
  }
}

function cancelDelayedStartTimer() {

  if (delayedStartTimer !== null) {

    Timer.clear(delayedStartTimer);
    delayedStartTimer = null;

    log("Delayed start cancelled");
  }
}

// ============================================================================
// THERMOSTAT ON
// ============================================================================

function thermostatOn() {

  log("Thermostat ON");

  thermostatDemand = true;

  cancelHoldTimer();

  let now =
    Math.floor(Date.now() / 1000);

  // Cooldown active
  if (now < cooldownUntil) {

    let remaining =
      cooldownUntil - now;

    cancelDelayedStartTimer();

    delayedStartTimer = Timer.set(
      remaining * 1000,
      false,
      function () {

        delayedStartTimer = null;

        if (thermostatDemand) {

          log(
            "Cooldown finished, starting heat pump"
          );

          heatPumpOn();
        }
      }
    );

    log(
      "Cooldown active, delayed start in " +
      remaining +
      " seconds"
    );

    return;
  }

  heatPumpOn();
}

// ============================================================================
// THERMOSTAT OFF
// ============================================================================

function thermostatOff() {

  log("Thermostat OFF");