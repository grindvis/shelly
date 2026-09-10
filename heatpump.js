/**
 * Slimme cyclusbeheerder voor warmtepompen
 *
 * DOEL
 * Voorkomen dat een modulerende thermostaat ervoor zorgt dat de warmtepomp
 * te vaak kort achter elkaar in- en uitschakelt.
 *
 * Dit gebeurt door twee Shelly-apparaten te laten samenwerken:
 * één apparaat schakelt de warmtepomp rechtstreeks en één apparaat
 * fungeert als ingang voor het thermostaatsignaal.
 *
 * VEREISTEN
 * 1. Een (modulerende) thermostaat die AAN- en UIT-signalen via een relais
 *    kan leveren.
 * 2. Een Shelly-apparaat dat scripting ondersteunt (bijvoorbeeld Gen2-relais
 *    of nieuwer) om als schakelaar voor de warmtepomp te fungeren.
 * 3. Een Shelly-apparaat dat webhooks kan versturen (de meeste modellen)
 *    om als ingang voor het thermostaatsignaal te fungeren.
 * 4. Vaste IP-adressen voor beide Shelly-apparaten om netwerkproblemen
 *    te voorkomen.
 *
 * GEDRAG / ACCEPTATIECRITERIA
 * - Wanneer de thermostaat AAN gaat, moet de warmtepomp onmiddellijk AAN gaan.
 * - Wanneer de thermostaat UIT gaat, blijft de warmtepomp gedurende een
 *   ingestelde wachttijd AAN (uitlooptijd) om korte cycli te voorkomen.
 * - Als de thermostaat tijdens deze wachttijd weer AAN gaat, wordt de
 *   lopende timer geannuleerd en blijft de warmtepomp AAN.
 * - Als de wachttijd verstrijkt, wordt de warmtepomp UITgeschakeld en
 *   begint een afkoeltimer (om een onmiddellijke herstart te voorkomen).
 *
 * OPMERKINGEN
 * - Kopieer en plak deze code niet zomaar; de code is bedoeld als referentie
 *   en kan aanpassingen vereisen om met jouw specifieke installatie te werken.
 * - Kies de wachttijd en afkoeltijd zorgvuldig; het kan enige tijd kosten
 *   om deze waarden goed af te stellen.
 *   In de installatie van de auteur werkte een wachttijd van 10–15 minuten goed.
 * - Test wijzigingen veilig en houd de warmtepomp goed in de gaten om
 *   onnodige belasting van de apparatuur te voorkomen.
 * - Dit script is geschreven voor de volgende combinatie van Shelly-apparaten:
 *   - Shelly Plus 1 Mini om de warmtepomp te schakelen.
 *   - Shelly UNI (Gen1) als ingang voor het thermostaatsignaal
 *     (iedere Shelly-relais die webhooks kan versturen kan hiervoor
 *     worden gebruikt).
 * - Er zijn meerdere manieren om dit te implementeren; dit is slechts
 *   één aanpak die is gebaseerd op de reeds geïnstalleerde apparaten.
 *   Idealiter is de thermostaat gebaseerd op een Shelly UNI (Gen2)
 *   met een temperatuursensor, waarbij een script rechtstreeks de
 *   warmtepomp schakelt (alle logica in de thermostaat).
 */

/**
 * Thermostat webhook configuratie:
 * Stel onderstaande URL's in als webhooks in de thermostaat (Shelly UNI) om de 
 * warmtepomp te schakelen. Let op: kies de juiste switch, de UNI heeft er twee.
 * ON: http://[ip-adres warmtepomp relais]/script/1/warmtepomp_aan
 * OFF: http://[ip-adres warmtepomp relais]/script/1/warmtepomp_uit
 */

var THERM_IP = "[ip-adres thermostaat]"; // IP-adres van de Shelly Uni/thermostaat
var VERTRAGING_MS = 15 * 60 * 1000; // 15 minuten
//Voor testen (5 seconden)
//var VERTRAGING_MS = 5000; // 5 seconden
var offTimer = null;
// Timer voor het geval de thermostaat niet reageert (bijvoorbeeld door een netwerkstoring).
// Zodat de thermostaat niet te lang de warmtepomp aan laat staan.
var COMM_FAIL_LIMIT = 4;   // 4 uur
var commFailCount = 0;

// ------------------------------------------------------------
// Zet Mini AAN and cancel UIT
// ------------------------------------------------------------
function thermOn() {
  console.log("Thermostaat AAN ontvangen");
  // Cancel UIT timer
  if (offTimer !== null) {
    Timer.clear(offTimer);
    offTimer = null;
    console.log("Vertraagde uitschakeling geannuleerd");
  }

  // Zet relay AAN
  Shelly.call("Switch.Set", {
    id: 0,
    on: true
  }, function(result, error_code, error_message) {

    if (error_code !== 0) {
      console.log("FOUT bij het inschakelen van het relais: " + error_message);
    } else {
      console.log("Thermostaat is AAN");
    }
  });
}


// ------------------------------------------------------------
// Thermostaat is UIT - start vertraagd uitschakelen 
// ------------------------------------------------------------
function thermOff() {
  console.log("Thermostaat UIT ontvangen");
  // Als er al een timer is, annuleer deze
  if (offTimer !== null) {
    Timer.clear(offTimer);
    offTimer = null;
  }
  console.log("Start vertraagde uitschakeling van 15 minuten");
  offTimer = Timer.set(VERTRAGING_MS, false, function() {
    offTimer = null;
    console.log("15 minuten zijn voorbij, controleer status van de thermostaat");
    checkthermState();
  });
}

// ------------------------------------------------------------
// Bevraag de status van de thermostaat
// ------------------------------------------------------------
function checkthermState() {

  Shelly.call("HTTP.GET", {
    url: "http://" + THERM_IP + "/status",
    timeout: 10
  }, function(result, error_code, error_message) {
    if (error_code !== 0) {
      console.log("ERROR bevragen thermostaat: " + error_message);
      return;
    }
    if (!result || !result.body) {
      console.log("ERROR: Thermostaat geeft geen reactie");
      return;
    }
    var status;
    try {
      status = JSON.parse(result.body);
    } catch (e) {
      console.log("ERROR parsing thermostaat reactie");
      return;
    }
    if (!status.inputs || status.inputs.length < 1) {
      console.log("ERROR: Kon Input 1 niet vinden in thermostaatstatus");
      return;
    }

    var thermIsOn = (status.inputs[0].input === 1);
    console.log("Thermostaat is " + (thermIsOn ? "AAN" : "UIT"));
    if (thermIsOn) {

      // Thermostaat ingeschakeld gedurende de vertraagde uitschakeling van 15 minuten 
      // Hou de warmtepomp AAN.
      console.log("Thermostaat is AAN, houd de warmtepomp AAN");

      Shelly.call("Switch.Set", {
        id: 0,
        on: true
      });

    } else {

      // Thermostaat is nog steeds uit na 15 minuten.
      // Zet de warmtepomp uit.
      console.log("Thermostaat is nog steeds uit - zet de warmtepomp uit");

      Shelly.call("Switch.Set", {
        id: 0,
        on: false
      });
    }

  });
}

// ------------------------------------------------------------
// Controleer of de thermostaat bereikbaar is (watchdog)
// ------------------------------------------------------------
function thermostatWatchdog() {

  Shelly.call("HTTP.GET", {
    url: "http://" + THERM_IP + "/status",
    timeout: 10
  }, function(result, error_code, error_message) {

    if (error_code !== 0 || !result || !result.body) {

      commFailCount++;

      console.log(
        "Thermostaat niet bereikbaar (" +
        commFailCount +
        "/" +
        COMM_FAIL_LIMIT +
        ")"
      );

      if (commFailCount >= COMM_FAIL_LIMIT) {

        console.log(
          "Thermostaat meer dan 4 uur onbereikbaar -> warmtepomp UIT"
        );

        if (offTimer !== null) {
          Timer.clear(offTimer);
          offTimer = null;
        }

        Shelly.call("Switch.Set", {
          id: 0,
          on: false
        });
      }

      return;
    }

    // Communicatie werkt weer
    if (commFailCount > 0) {
      console.log("Thermostaat weer bereikbaar");
    }

    commFailCount = 0;
  });
}


// ------------------------------------------------------------
// HTTP endpoint: /script/1/warmtepomp_aan
//
// Aangeroepen door de thermostaat (Shelly therm) als IN1 aan gaat 
// ------------------------------------------------------------
HTTPServer.registerEndpoint("warmtepomp_aan", function(request, response) {

  thermOn();

  response.code = 200;
  response.body = "OK - Warmtepomp AAN, vertraagde uitschakeling geannuleerd";
  response.send();

});


// ------------------------------------------------------------
// HTTP endpoint: /script/1/warmtepomp_uit
//
// Aangeroepen door de thermostaat (Shelly Uni) als IN1 uit gaat 
// ------------------------------------------------------------
HTTPServer.registerEndpoint("warmtepomp_uit", function(request, response) {

  thermOff();

  response.code = 200;
  response.body = "OK - vertraagde uitschakeling van 15 minuten gestart";
  response.send();

});


// Elke uur controleren of de UNI nog bereikbaar is
Timer.set(60 * 60 * 1000, true, thermostatWatchdog);
// Logging
console.log("========================================");
console.log("Vertraagde uitschakeling van warmtepomp gestart");
console.log("Thermostaat IP: " + THERM_IP);
console.log("Vertraagde uitschakeling: 15 minuten");
console.log("========================================");