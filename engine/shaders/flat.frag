precision mediump float;

varying vec3 vColor;
varying vec2 vUV;

uniform bool uUseTexture;
uniform sampler2D uTexture;
uniform vec3 uColor;
uniform float uFaceSelected;

void main() {
    vec3 color = vColor * uColor;
    if (uUseTexture && vUV.x >= 0.0 && vUV.x <= 1.0 && vUV.y >= 0.0 && vUV.y <= 1.0) {
        color *= texture2D(uTexture, vUV).rgb;
    }
    color = mix(color, vec3(1.0, 0.72, 0.12), uFaceSelected * 0.35);
    gl_FragColor = vec4(color, 1.0);
}
