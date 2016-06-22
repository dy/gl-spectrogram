/**
 * Lightweight canvas version of a spectrogram.
 * @module gl-spectrogram/2d
 */

var Spectrogram = require('./lib/core');


Spectrogram.prototype.context = '2d';

Spectrogram.prototype.init = function () {

};

var imgData = ctx.getImageData(0,0, width, height);
ctx.putImageData(imgData, -1, 0);