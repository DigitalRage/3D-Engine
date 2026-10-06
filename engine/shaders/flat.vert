attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aUV;
attribute vec4 aInstance0;
attribute vec4 aInstance1;
attribute vec4 aInstance2;
attribute vec4 aInstance3;
attribute vec4 aInstanceColor;

uniform mat4 uModel;
uniform float uInstanced;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec4 uUVTransform;
uniform float uUVRotation;
uniform vec2 uUVCenter;

varying vec3 vColor;
varying vec3 vNormal;
varying vec2 vUV;

void main() {
    vColor = aColor;
    if (uInstanced > 0.5) vColor *= aInstanceColor.rgb;
    vec2 uv = aUV - uUVCenter;
    float c = cos(uUVRotation);
    float s = sin(uUVRotation);
    uv = mat2(c, -s, s, c) * uv;
    vUV = uv * uUVTransform.xy + uUVCenter + uUVTransform.zw;

    mat4 model = uModel;
    if (uInstanced > 0.5) {
        model = mat4(aInstance0, aInstance1, aInstance2, aInstance3);
    }
    vec3 modelScale = vec3(length(model[0].xyz), length(model[1].xyz), length(model[2].xyz));
    vec3 inverseSquaredScale = vec3(1.0) / max(modelScale * modelScale, vec3(0.0000001));
    vNormal = normalize(mat3(model) * (aNormal * inverseSquaredScale));
    gl_Position = uProj * uView * model * vec4(aPosition, 1.0);
}
