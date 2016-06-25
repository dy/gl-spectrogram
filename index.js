/**
 * WebGL version
 * @module  gl-spectrogram
 */

var Spectrogram = require('./lib/core');
var Component = require('gl-component');

module.exports = Spectrogram;

//hook up webgl rendering routines
Spectrogram.prototype.init = function () {
	var gl = this.gl;

	//preset colormap texture
	this.setTexture('fill', {
		unit: 3,
		type: gl.UNSIGNED_BYTE,
		filter: gl.LINEAR,
		wrap: gl.CLAMP_TO_EDGE,
	});

	//save texture location
	this.textureLocation = gl.getUniformLocation(this.program, 'texture');
	this.maxFrequencyLocation = gl.getUniformLocation(this.program, 'maxFrequency');
	this.minFrequencyLocation = gl.getUniformLocation(this.program, 'minFrequency');
	this.maxDecibelsLocation = gl.getUniformLocation(this.program, 'maxDecibels');
	this.minDecibelsLocation = gl.getUniformLocation(this.program, 'minDecibels');
	this.logarithmicLocation = gl.getUniformLocation(this.program, 'logarithmic');
	this.sampleRateLocation = gl.getUniformLocation(this.program, 'sampleRate');

	var size = this.size;

	this.shiftComponent = Component({
		context: gl,
		textures: {
			texture: {
				unit: 0,
				data: null,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE,
				width: size[0],
				height: size[1]
			},
			altTexture: {
				unit: 1,
				data: null,
				format: gl.RGBA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE,
				width: size[0],
				height: size[1]
			},
			frequencies: {
				unit: 2,
				data: null,
				format: gl.ALPHA,
				type: gl.UNSIGNED_BYTE,
				filter: gl.NEAREST,
				wrap: gl.CLAMP_TO_EDGE
			}
		},
		frag: `
			precision highp float;

			uniform sampler2D texture;
			uniform sampler2D frequencies;
			uniform vec4 viewport;
			uniform float count;

			const float padding = 1.;

			void main () {
				vec2 one = vec2(1) / viewport.zw;
				vec2 coord = gl_FragCoord.xy / viewport.zw;

				//do not shift if there is a room for the data
				if (count < viewport.z - padding) {
					vec3 color = texture2D(texture, coord).xyz;
					float mixAmt = step(count, gl_FragCoord.x);
					color = mix(color, texture2D(frequencies, vec2(coord.y,.5)).www, mixAmt);
					mixAmt *= (- count - padding + gl_FragCoord.x) / padding;
					color = mix(color, vec3(0), mixAmt);
					gl_FragColor = vec4(color, 1);
				}
				else {
					coord.x += one.x;
					vec3 color = texture2D(texture, coord).xyz;
					float mixAmt = step(viewport.z - padding, gl_FragCoord.x);
					color = mix(color, texture2D(frequencies, vec2(coord.y,.5)).www, mixAmt);
					mixAmt *= (- viewport.z + gl_FragCoord.x) / padding;
					color = mix(color, vec3(0), mixAmt);
					gl_FragColor = vec4(color, 1);
				}
			}
		`,
		phase: 0,
		spectrogram: this,
		framebuffer: gl.createFramebuffer(),
		render: function () {
			var gl = this.gl;

			gl.useProgram(this.program);

			//TODO: throttle rendering here
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[this.phase ? 'texture' : 'altTexture'].texture, 0);
			gl.uniform1i(this.textures.texture.location, this.phase);

			this.phase = (this.phase + 1) % 2;

			//vp is unbound from canvas, so we have to manually set it
			gl.uniform4fv(gl.getUniformLocation(this.program, 'viewport'), [0,0,size[0], size[1]]);
			gl.viewport(0,0,size[0],size[1]);
			this.draw(this);

			gl.bindFramebuffer(gl.FRAMEBUFFER, null);

			gl.useProgram(this.spectrogram.program);
			gl.uniform1i(this.spectrogram.textureLocation, this.phase);
		},
		autostart: false,
		float: this.float,
		antialias: this.antialias
	});

	//hook up counter
	this.shiftComponent.count = 0;
	this.shiftComponent.countLocation = gl.getUniformLocation(this.shiftComponent.program, 'count');

	//shift data on push
	this.on('push', (magnitudes) => {
		this.shiftComponent.setTexture('frequencies', magnitudes);

		//update count
		this.shiftComponent.count++;
		gl.uniform1f(this.shiftComponent.countLocation, this.shiftComponent.count);

		//do shift
		this.shiftComponent.render();
	});

	//update uniforms
	this.on('update', () => {
		gl.uniform1f(this.minFrequencyLocation, this.minFrequency);
		gl.uniform1f(this.maxFrequencyLocation, this.maxFrequency);
		gl.uniform1f(this.minDecibelsLocation, this.minDecibels);
		gl.uniform1f(this.maxDecibelsLocation, this.maxDecibels);
		gl.uniform1f(this.logarithmicLocation, this.logarithmic ? 1 : 0);
		gl.uniform1f(this.sampleRateLocation, this.sampleRate);
	});
};

//background texture size
Spectrogram.prototype.size = [1024, 1024];

//default renderer just outputs active texture
Spectrogram.prototype.frag = `
	precision highp float;

	uniform sampler2D texture;
	uniform sampler2D fill;
	uniform vec4 viewport;
	uniform float sampleRate;
	uniform float maxFrequency;
	uniform float minFrequency;
	uniform float maxDecibels;
	uniform float minDecibels;
	uniform float logarithmic;


	const float log10 = ${Math.log(10)};

	float lg (float x) {
		return log(x) / log10;
	}

	//return a or b based on weight
	float decide (float a, float b, float w) {
		return step(0.5, w) * b + step(w, 0.5) * a;
	}

	//get mapped frequency
	float f (float ratio) {
		float halfRate = sampleRate * .5;

		float logF = pow(10., lg(minFrequency) + ratio * (lg(maxFrequency) - lg(minFrequency)) );

		ratio = decide(ratio, (logF - minFrequency) / (maxFrequency - minFrequency), logarithmic);

		float leftF = minFrequency / halfRate;
		float rightF = maxFrequency / halfRate;

		ratio = leftF + ratio * (rightF - leftF);

		return ratio;
	}

	void main () {
		vec2 coord = (gl_FragCoord.xy - viewport.xy) / viewport.zw;
		float intensity = texture2D(texture, vec2(coord.x, f(coord.y))).x;
		intensity = (intensity * 100. - minDecibels - 100.) / (maxDecibels - minDecibels);
		gl_FragColor = vec4(vec3(texture2D(fill, vec2(intensity, coord.y) )), 1);
	}
`;
