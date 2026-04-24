'use client';
import React, { useRef, useEffect } from 'react';

const useShaderBackground = () => {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef();
  const rendererRef = useRef(null);
  const pointersRef = useRef(null);

  class WebGLRenderer {
    constructor(canvas, scale) {
      this.canvas = canvas;
      this.scale = scale;
      this.gl = canvas.getContext('webgl2');
      this.gl.viewport(0, 0, canvas.width * scale, canvas.height * scale);
      this.shaderSource = defaultShaderSource;
      this.mouseMove = [0, 0];
      this.mouseCoords = [0, 0];
      this.pointerCoords = [0, 0];
      this.nbrOfPointers = 0;
      this.program = null;
      this.vs = null;
      this.fs = null;
      this.buffer = null;

      this.vertexSrc = `#version 300 es
precision highp float;
in vec4 position;
void main(){gl_Position=position;}`;

      this.vertices = [-1, 1, -1, -1, 1, 1, 1, -1];
    }

    updateShader(source) {
      this.reset();
      this.shaderSource = source;
      this.setup();
      this.init();
    }

    updateMove(deltas) {
      this.mouseMove = deltas;
    }

    updateMouse(coords) {
      this.mouseCoords = coords;
    }

    updatePointerCoords(coords) {
      this.pointerCoords = coords;
    }

    updatePointerCount(nbr) {
      this.nbrOfPointers = nbr;
    }

    updateScale(scale) {
      this.scale = scale;
      this.gl.viewport(0, 0, this.canvas.width * scale, this.canvas.height * scale);
    }

    compile(shader, source) {
      const gl = this.gl;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        console.error('Shader compilation error:', error);
      }
    }

    test(source) {
      let result = null;
      const gl = this.gl;
      const shader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        result = gl.getShaderInfoLog(shader);
      }
      gl.deleteShader(shader);
      return result;
    }

    reset() {
      const gl = this.gl;
      if (this.program && !gl.getProgramParameter(this.program, gl.DELETE_STATUS)) {
        if (this.vs) {
          gl.detachShader(this.program, this.vs);
          gl.deleteShader(this.vs);
        }
        if (this.fs) {
          gl.detachShader(this.program, this.fs);
          gl.deleteShader(this.fs);
        }
        gl.deleteProgram(this.program);
      }
    }

    setup() {
      const gl = this.gl;
      this.vs = gl.createShader(gl.VERTEX_SHADER);
      this.fs = gl.createShader(gl.FRAGMENT_SHADER);
      this.compile(this.vs, this.vertexSrc);
      this.compile(this.fs, this.shaderSource);
      this.program = gl.createProgram();
      gl.attachShader(this.program, this.vs);
      gl.attachShader(this.program, this.fs);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(this.program));
      }
    }

    init() {
      const gl = this.gl;
      const program = this.program;
      
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.STATIC_DRAW);

      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      program.resolution = gl.getUniformLocation(program, 'resolution');
      program.time = gl.getUniformLocation(program, 'time');
      program.move = gl.getUniformLocation(program, 'move');
      program.touch = gl.getUniformLocation(program, 'touch');
      program.pointerCount = gl.getUniformLocation(program, 'pointerCount');
      program.pointers = gl.getUniformLocation(program, 'pointers');
    }

    render(now = 0) {
      const gl = this.gl;
      const program = this.program;
      
      if (!program || gl.getProgramParameter(program, gl.DELETE_STATUS)) return;

      // Base color for the canvas - changed to match our light paper theme
      gl.clearColor(0.98, 0.98, 0.97, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      
      gl.uniform2f(program.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(program.time, now * 1e-3);
      gl.uniform2f(program.move, ...this.mouseMove);
      gl.uniform2f(program.touch, ...this.mouseCoords);
      gl.uniform1i(program.pointerCount, this.nbrOfPointers);
      gl.uniform2fv(program.pointers, this.pointerCoords);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  class PointerHandler {
    constructor(element, scale) {
      this.scale = scale;
      this.active = false;
      this.pointers = new Map();
      this.lastCoords = [0, 0];
      this.moves = [0, 0];
      
      const map = (element, scale, x, y) => 
        [x * scale, element.height - y * scale];

      element.addEventListener('pointerdown', (e) => {
        this.active = true;
        this.pointers.set(e.pointerId, map(element, this.getScale(), e.clientX, e.clientY));
      });

      element.addEventListener('pointerup', (e) => {
        if (this.count === 1) {
          this.lastCoords = this.first;
        }
        this.pointers.delete(e.pointerId);
        this.active = this.pointers.size > 0;
      });

      element.addEventListener('pointerleave', (e) => {
        if (this.count === 1) {
          this.lastCoords = this.first;
        }
        this.pointers.delete(e.pointerId);
        this.active = this.pointers.size > 0;
      });

      element.addEventListener('pointermove', (e) => {
        if (!this.active) return;
        this.lastCoords = [e.clientX, e.clientY];
        this.pointers.set(e.pointerId, map(element, this.getScale(), e.clientX, e.clientY));
        this.moves = [this.moves[0] + e.movementX, this.moves[1] + e.movementY];
      });
    }

    getScale() {
      return this.scale;
    }

    updateScale(scale) {
      this.scale = scale;
    }

    get count() {
      return this.pointers.size;
    }

    get move() {
      return this.moves;
    }

    get coords() {
      return this.pointers.size > 0 
        ? Array.from(this.pointers.values()).flat() 
        : [0, 0];
    }

    get first() {
      return this.pointers.values().next().value || this.lastCoords;
    }
  }

  const resize = () => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const dpr = Math.max(1, 0.5 * window.devicePixelRatio);
    
    // Make the canvas fit the container
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    if (rendererRef.current) {
      rendererRef.current.updateScale(dpr);
    }
  };

  const loop = (now) => {
    if (!rendererRef.current || !pointersRef.current) return;
    
    rendererRef.current.updateMouse(pointersRef.current.first);
    rendererRef.current.updatePointerCount(pointersRef.current.count);
    rendererRef.current.updatePointerCoords(pointersRef.current.coords);
    rendererRef.current.updateMove(pointersRef.current.move);
    rendererRef.current.render(now);
    animationFrameRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = Math.max(1, 0.5 * window.devicePixelRatio);
    
    rendererRef.current = new WebGLRenderer(canvas, dpr);
    pointersRef.current = new PointerHandler(canvas, dpr);
    
    rendererRef.current.setup();
    rendererRef.current.init();
    
    resize();
    
    if (rendererRef.current.test(defaultShaderSource) === null) {
      rendererRef.current.updateShader(defaultShaderSource);
    }
    
    loop(0);
    
    window.addEventListener('resize', resize);
    
    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (rendererRef.current) {
        rendererRef.current.reset();
      }
    };
  }, []);

  return canvasRef;
};

// Adapted to our light, editorial theme by inverting the dark space shader
// and tinting it slightly amber to match the design system.
const defaultShaderSource = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 resolution;
uniform float time;
#define FC gl_FragCoord.xy
#define T time
#define R resolution
#define MN min(R.x,R.y)
float rnd(vec2 p) {
  p=fract(p*vec2(12.9898,78.233));
  p+=dot(p,p+34.56);
  return fract(p.x*p.y);
}
float noise(in vec2 p) {
  vec2 i=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  float a=rnd(i), b=rnd(i+vec2(1,0)), c=rnd(i+vec2(0,1)), d=rnd(i+1.);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
float fbm(vec2 p) {
  float t=.0, a=1.; mat2 m=mat2(1.,-.5,.2,1.2);
  for (int i=0; i<5; i++) {
    t+=a*noise(p);
    p*=2.*m;
    a*=.5;
  }
  return t;
}
float clouds(vec2 p) {
	float d=1., t=.0;
	for (float i=.0; i<3.; i++) {
		float a=d*fbm(i*10.+p.x*.2+.2*(1.+i)*p.y+d+i*i+p);
		t=mix(t,d,a);
		d=a;
		p*=2./(i+1.);
	}
	return t;
}
void main(void) {
	vec2 uv=(FC-.5*R)/MN,st=uv*vec2(2,1);
	vec3 cloudCol=vec3(0);
    vec3 starCol=vec3(0);
	float bg=clouds(vec2(st.x+T*.5,-st.y));
	uv*=1.-.3*(sin(T*.2)*.5+.5);
    
	for (float i=1.; i<12.; i++) {
        // Use .15 for spread to keep the stars spaced out
		uv+=.15*cos(i*vec2(.1+.01*i, .8)+i*i+T*.5+.1*uv.x);
		vec2 p=uv;
		float d=length(p);
        
        // Draw fewer stars (i < 7.) to keep the gaps big
        if (i < 7.) {
            // Reverted to original small, precise star core size (.00125)
            starCol+=.00125/d*(cos(sin(i)*vec3(1,2,3))+1.);
            float b=noise(i+p+bg*1.731);
            // Reverted to original thin, elegant tail (.002 thickness, .02 stretch multiplier)
            starCol+=.002*b/length(max(p,vec2(b*p.x*.02,p.y)));
        }
        
        // Generate the background clouds
		cloudCol=mix(cloudCol,vec3(bg*.25,bg*.137,bg*.05),d);
	}
    
    // 1. Recreate the light sky-blue background from the first iteration
    vec3 lightBg = vec3(0.98, 0.98, 0.97); 
    vec3 baseCol = lightBg - (cloudCol * 0.4); 
    baseCol = mix(baseCol, vec3(0.72, 0.52, 0.04), cloudCol.r * 0.15);
    
    // 2. Paint the bright, delicate, glowing stars on top
    vec3 starTint = vec3(0.85, 0.55, 0.10); 
    float intensity = length(starCol);
    vec3 finalCol = mix(baseCol, starTint, min(intensity * 1.5, 1.0));
    finalCol += starCol * 0.25; 
    
	O=vec4(finalCol, 1);
}`;

const AnimatedShaderHero = ({ children }) => {
  const canvasRef = useShaderBackground();

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      minHeight: '400px',
      padding: '4rem 1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: '12px',
      border: '1px solid var(--border)',
      marginBottom: '2rem',
      boxShadow: 'var(--shadow-sm)'
    }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          touchAction: 'none',
          zIndex: 0,
          opacity: 0.8
        }}
      />
      
      {/* Content overlay */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        width: '100%',
        maxWidth: '48rem',
        animation: 'fade-in-up 0.8s ease-out forwards'
      }}>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}} />
        {children}
      </div>
    </div>
  );
};

export default AnimatedShaderHero;
