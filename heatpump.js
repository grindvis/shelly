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
 * ON: http://192.168.1.181/script/1/thermostat_on
 * OFF: http://192.168.1.181/script/1/thermostat_off
 */

// -----------------------------------------------------------------------------
// CONFIGURATION
// -----------------------------------------------------------------------------

let CONFIG = {
  switchId: 0,

  // Shelly running this script
  heatPumpShellyIp: "192.168.1.181",

  // Keep heat pump running after thermostat OFF
  holdTimeSec: 15 * 60,

  // Minimum OFF time before restart
  cooldownTimeSec: 10 * 60
};

// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------

let thermostatDemand = false;
let holdTimer = null;
let startTimer = null;
let cooldownUntil = 0;

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function now() {
  let sys = Shelly.getComponentStatus("sys");
  return sys.unixtime;
}

function heatPumpOn() {
  Shelly.call("Switch.Set", {
    id: CONFIG.switchId,
    on: true
  });
}

function heatPumpOff() {
  Shelly.call("Switch.Set", {
    id: CONFIG.switchId,
    on: false
  });
}

function cancelTimer(timerId) {
  if (timerId !== null) {
    Timer.clear(timerId);
  }
  return null;
}

// -----------------------------------------------------------------------------
// THERMOSTAT ON
// -----------------------------------------------------------------------------

function thermostatOn() {

  thermostatDemand = true;

  holdTimer = cancelTimer(holdTimer);

  let remainingCooldown = cooldownUntil - now();

  if (remainingCooldown > 0) {

    startTimer = cancelTimer(startTimer);

    startTimer = Timer.set(
      remainingCooldown * 1000,
      false,
      function () {

        startTimer = null;

        if (thermostatDemand) {
          heatPumpOn();
        }
      }
    );

    return;
  }

  heatPumpOn();
}

// -----------------------------------------------------------------------------
// THERMOSTAT OFF
// -----------------------------------------------------------------------------

function thermostatOff() {

  thermostatDemand = false;

  startTimer = cancelTimer(startTimer);
  holdTimer = cancelTimer(holdTimer);

  holdTimer = Timer.set(
    CONFIG.holdTimeSec * 1000,
    false,
    function () {

      holdTimer = null;

      if (thermostatDemand) {
        return;
      }

      heatPumpOff();

      cooldownUntil =
        now() + CONFIG.cooldownTimeSec;
    }
  );
}

// -----------------------------------------------------------------------------
// WEBHOOKS
// -----------------------------------------------------------------------------

HTTPServer.registerEndpoint("on", function (req, res) {

  thermostatOn();

  res.code = 200;
  res.body = "OK";
  res.send();
});

HTTPServer.registerEndpoint("off", function (req, res) {

  thermostatOff();

  res.code = 200;
  res.body = "OK";
  res.send();
});

// -----------------------------------------------------------------------------
// STARTUP
// -----------------------------------------------------------------------------

print("Heat Pump Cycle Manager started");
print("Configure thermostat webhooks:");
print("ON  -> http://" + CONFIG.heatPumpShellyIp + "/script/1/on");
print("OFF -> http://" + CONFIG.heatPumpShellyIp + "/script/1/off");