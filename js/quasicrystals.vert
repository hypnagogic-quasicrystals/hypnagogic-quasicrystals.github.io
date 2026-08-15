attribute vec3 aPosition;
attribute vec2 aTexCoord;

varying vec2 vTexCoord;
varying vec3 vDirection;

uniform mat4 uModelViewProjectionMatrix;

void main() {
    vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
    vDirection = normalize(aPosition);
    gl_Position = uModelViewProjectionMatrix * vec4(aPosition, 1.0);
}
