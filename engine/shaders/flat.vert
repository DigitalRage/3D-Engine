attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
attribute vec3 aColor;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec4 uUVTransform;
uniform float uUVRotation;

varying vec3 vColor;
varying vec2 vUV;

void main() {
    vColor = aColor;
    vec2 uv = aUV - vec2(0.5);
    float c = cos(uUVRotation);
    float s = sin(uUVRotation);
    uv = mat2(c, -s, s, c) * uv;
    vUV = uv * uUVTransform.xy + vec2(0.5) + uUVTransform.zw;
    gl_Position = uProj * uView * uModel * vec4(aPosition, 1.0);
}
