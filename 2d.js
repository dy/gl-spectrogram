/**
 * Lightweight canvas version of a spectrogram.
 * @module gl-spectrogram/2d
 */

var Spectrogram = require('./lib/core');
var parseColor = require('color-parse');

module.exports = Spectrogram;

Spectrogram.prototype.context = '2d';
Spectrogram.prototype.autostart = false;

Spectrogram.prototype.init = function () {
	var ctx = this.context;

	//render only on pushes
	this.on('push', (magnitudes) => {
		this.render(magnitudes);
	});

	//on color update
	this.on('update', () => {
		this.colorValues = parseColor(this.color).values;
		this.bgValues = parseColor(this.canvas.style.background).values;
	});
};


//get mapped frequency
function lg (x) {
	return Math.log(x) / Math.log(10);
}

Spectrogram.prototype.f = function (ratio) {
	var halfRate = this.sampleRate * .5;
	if (this.logarithmic) {
		var logF = Math.pow(10., Math.log10(this.minFrequency) + ratio * (Math.log10(this.maxFrequency) - Math.log10(this.minFrequency)) );
		ratio = (logF - this.minFrequency) / (this.maxFrequency - this.minFrequency);
	}

	var leftF = this.minFrequency / halfRate;
	var rightF = this.maxFrequency / halfRate;

	ratio = leftF + ratio * (rightF - leftF);

	return ratio;
}

Spectrogram.prototype.draw = function (data) {
	var ctx = this.context;
	var width = this.viewport[2],
		height = this.viewport[3];

	if (!this.bgValues) {
		return;
	}

	//displace canvas
	var imgData = ctx.getImageData(this.viewport[0], this.viewport[1], width, height);
	ctx.putImageData(imgData, this.viewport[0]-1, this.viewport[1]);

	var bg = this.bgValues, color = this.colorValues;

	//put new slice
	var step = 1;//height / (array.length / 2);
	for (var i = 0; i < height; i++) {
		var ratio = i / height;
		var mixAmt = data[(this.f(ratio) * data.length)|0] / 255;
		var values = bg.map((v,i) => (v * (1 - mixAmt) + color[i] * mixAmt)|0 );
		ctx.fillStyle = `rgb(${values.join(',')})`;
		ctx.fillRect(this.viewport[0] + width - 1, this.viewport[1] + height - i, 1, step);
	}
}