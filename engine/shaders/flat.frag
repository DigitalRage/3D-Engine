precision mediump float;

varying vec3 vColor;
varying vec2 vUV;

uniform bool uUseTexture;
uniform sampler2D uTexture;
uniform vec3 uColor;

void main() {
    vec3 color = vColor * uColor;
    if (uUseTexture) {
        color *= texture2D(uTexture, vUV).rgb;
    }
    gl_FragColor = vec4(color, 1.0);
}
