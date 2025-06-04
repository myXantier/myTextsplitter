import { shadeColor } from './utils/helper';
import { benchmark } from './utils/benchmark';

// console.log("1: ", shade(0.3, '#62AEEF'));
// console.log("2: ", shade(0.5, '#62AEEF'));

console.log("meins 1: ", shadeColor(0.3, '#62AEEF'));
console.log("meins 2: ", shadeColor(0.5, '#62AEEF'));


const resultShadeColor = benchmark(() => shadeColor(0.3, '#62AEEF'), 100);
// const resultShade = benchmark(() => shade(0.3, '#62AEEF'), 100);

console.log("shadeColor: ", resultShadeColor.resultText);
// console.log("shade: ", resultShade.resultText);