// This script is wrtitten to make a traditional (modulating) thermostat a bit smarter by using two shelly
// devices for switching a heat pump system. Using a traditional of modulating thermostat will cause the 
// heatpump to short-cycle (switching on and off multiple times a minute) which will have a tremendous negative
// impact on the system. 
// 
// REQUIREMENTS
// 1. A (modulating) thermostat with ON and OFF relais 
// 2. One Shelly device supporting scripting (most relais, starting from Gen2) acting as the heatpump switch
// 3. One shelly device capable of using webhooks (nearly all) acting as the thermostat switch
//
// NOTES
// Do your own research to find the best cycle-down time. In my specific case it took me more than a year to 
// fiddle with the system en determine a sweetspot between 10 and 15 minutes. 
//
// ACCEPTATION
// 1. The heatpump needs to turn ON when the termostat turns ON
// 2. The heatpump needs to remain ON for the set time after the termostat has switched OFF
// 3. If the timer is counting down, the set time needs to be reset when the thermostat switchs ON again
// 4. If the heatpump 
