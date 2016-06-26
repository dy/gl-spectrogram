/**
 * @module  gl-spectrogram/lib/core
 */


var extend = require('xtend/mutable');
var Component = require('gl-component');
var inherits = require('inherits');
var isBrowser = require('is-browser');
var createGrid = require('plot-grid');
var flatten = require('flatten');
var lg = require('mumath/lg');
var clamp = require('mumath/clamp');
var weighting = require('a-weighting');
var colormap = require('colormap');
var parseColor = require('color-parse');
var hsl = require('color-space/hsl');
var colorScales = require('colormap/colorScales');

module.exports = Spectrogram;



/**
 * @contructor
 */
function Spectrogram (options) {
	if (!(this instanceof Spectrogram)) return new Spectrogram(options);

	Component.call(this, options);

	if (isBrowser) this.container.classList.add(this.className);

	this.init();

	//preset initial freqs
	this.push(this.magnitudes);

	//init style props
	this.update();
}

inherits(Spectrogram, Component);

Spectrogram.prototype.className = 'gl-spectrogram';

Spectrogram.prototype.init = () => {};

Spectrogram.prototype.antialias = false;
Spectrogram.prototype.premultipliedAlpha = true;
Spectrogram.prototype.alpha = true;
Spectrogram.prototype.float = false;

Spectrogram.prototype.maxDecibels = -30;
Spectrogram.prototype.minDecibels = -90;

Spectrogram.prototype.maxFrequency = 20000;
Spectrogram.prototype.minFrequency = 40;

Spectrogram.prototype.smoothing = 0.75;
Spectrogram.prototype.details = 1;

Spectrogram.prototype.grid = true;
Spectrogram.prototype.axes = false;
Spectrogram.prototype.logarithmic = true;
Spectrogram.prototype.weighting = 'itu';
Spectrogram.prototype.sampleRate = 44100;

Spectrogram.prototype.fill = 'greys';
Spectrogram.prototype.background = undefined;



//array with initial values of the last moment
Spectrogram.prototype.magnitudes = Array(1024).fill(-150);


//set last actual frequencies values
Spectrogram.prototype.push = function (magnitudes) {
	if (!magnitudes) magnitudes = [-150];

	var gl = this.gl;
	var halfRate = this.sampleRate * 0.5;
	var l = halfRate / this.magnitudes.length;
	var w = weighting[this.weighting] || weighting.z;

	magnitudes = magnitudes.map((v, i) => {
		//apply weighting
		v = clamp(clamp(v, -100, 0) + 20 * Math.log(w(i * l)) / Math.log(10), -200, 0);

		return v;
	});

	//choose bigger data
	// var bigger = this.magnitudes.length >= magnitudes.length ? this.magnitudes : magnitudes;
	// var shorter = (bigger === magnitudes ? this.magnitudes : magnitudes);
	// bigger = [].slice.call(bigger);
	magnitudes = [].slice.call(magnitudes);

	//apply smoothing
	// var smoothing = (bigger === this.magnitudes ? 1 - this.smoothing : this.smoothing);
	var smoothing = this.smoothing;

	for (var i = 0; i < magnitudes.length; i++) {
		magnitudes[i] = magnitudes[i] * (1 - smoothing) + this.magnitudes[Math.floor(this.magnitudes.length * (i / magnitudes.length))] * smoothing;
	}

	//save actual magnitudes in db
	this.magnitudes = magnitudes;

	//find peak
	this.peak = this.magnitudes.reduce((prev, curr) => Math.max(curr, prev), -200);

	//emit magnitudes in db range
	this.emit('push', magnitudes, this.peak);

	return this;
};


/**
 * Reset colormap
 */
Spectrogram.prototype.setFill = function (cm, inverse) {
	this.fill = cm;
	this.inversed = inverse;

	//named colormap
	if (typeof cm === 'string') {
		//a color scale
		if (colorScales[cm]) {
			var cm = (flatten(colormap({
				colormap: cm,
				nshades: 128,
				format: 'rgba',
				alpha: 1
			})));//.map((v,i) => !((i + 1) % 4) ? v : v/255));
		}
		//url
		else if (/\\|\//.test(cm)) {
			this.setTexture('fill', cm);
			return this;
		}
		//plain color or CSS color string
		else {
			var parsed = parseColor(cm);

			if (parsed.space === 'hsl') {
				cm = hsl.rgb(parsed.values);
			}
			else {
				cm = parsed.values;
			}
		}
	}
	else if (!cm) {
		if (!this.background) this.setBackground([0,0,0,1]);
		return this;
	}
	//image, canvas etc
	else if (!Array.isArray(cm)) {
		this.setTexture('fill', cm);

		return this;
	}
	//custom array, like palette etc.
	else {
		cm = flatten(cm);
	}

	if (inverse) {
		var reverse = cm.slice();
		for (var i = 0; i < cm.length; i+=4){
			reverse[cm.length - i - 1] = cm[i + 3];
			reverse[cm.length - i - 2] = cm[i + 2];
			reverse[cm.length - i - 3] = cm[i + 1];
			reverse[cm.length - i - 4] = cm[i + 0];
		}
		cm = reverse;
	}

	this.setTexture('fill', {
		data: cm,
		height: 1,
		width: (cm.length / 4)|0
	});

	//ensure bg
	if (!this.background) {
		this.setBackground(cm.slice(0, 4));
	}

	var mainColor = cm.slice(-4);
	this.color = `rgba(${mainColor})`;

	this.fillData = cm;

	//set grid color to colormap’s color
	if (this.gridComponent) {
		this.gridComponent.linesContainer.style.color = this.color;
	}

	return this;
};


/** Set background */
Spectrogram.prototype.setBackground = function (bg) {
	if (this.background !== null) {
		var bgStyle = null;
		if (typeof bg === 'string') {
			bgStyle = bg;
		}
		else if (Array.isArray(bg)) {
			//map 0..1 range to 0..255
			if (bg[0] && bg[0] <= 1 && bg[1] && bg[1] <= 1 && bg[2] && bg[2] <= 1) {
				bg = [
					bg[0] * 255, bg[1] * 255, bg[2] * 255, bg[3] || 1
				];
			}

			bgStyle = `rgba(${bg.slice(0,3).map(v => Math.round(v)).join(', ')}, ${bg[3]})`;
		}
		this.canvas.style.background = bgStyle;
	}

	return this;
};




//update view
Spectrogram.prototype.update = function () {
	var gl = this.gl;

	if (typeof this.smoothing === 'string') {
		this.smoothing = parseFloat(this.smoothing);
	}

	if (this.grid) {
		if (!this.gridComponent) {
			this.gridComponent = createGrid({
				container: this.container,
				viewport: () => this.viewport,
				lines: Array.isArray(this.grid.lines) ? this.grid.lines : (this.grid.lines === undefined || this.grid.lines === true) && [{
					min: this.minFrequency,
					max: this.maxFrequency,
					orientation: 'y',
					logarithmic: this.logarithmic,
					titles: function (value) {
						return (value >= 1000 ? ((value / 1000).toLocaleString() + 'k') : value.toLocaleString()) + 'Hz';
					}
				}, this.logarithmic ? {
					min: this.minFrequency,
					max: this.maxFrequency,
					orientation: 'y',
					logarithmic: this.logarithmic,
					values: function (value) {
						var str = value.toString();
						if (str[0] !== '1') return null;
						return value;
					},
					titles: null,
					style: {
						borderLeftStyle: 'solid',
						pointerEvents: 'none',
						opacity: '0.08',
						display: this.logarithmic ? null :'none'
					}
				} : null],
				axes: Array.isArray(this.grid.axes) ? this.grid.axes : (this.grid.axes || this.axes) && [{
					name: 'Frequency',
					labels: function (value, i, opt) {
						var str = value.toString();
						if (str[0] !== '2' && str[0] !== '1' && str[0] !== '5') return null;
						return opt.titles[i];
					}
				}]
			});

			this.on('resize', () => {
				if (this.isPlannedGridUpdate) return;
				this.isPlannedGridUpdate = true;
				this.once('render', () => {
					this.isPlannedGridUpdate = false;
					this.gridComponent.update();
				});
			});
		}
		else {
			this.gridComponent.linesContainer.style.display = 'block';
		}
	}
	else if (this.gridComponent) {
		this.gridComponent.linesContainer.style.display = 'none';
	}

	this.setBackground(this.background);
	this.setFill(this.fill, this.inversed);

	this.emit('update');
};
