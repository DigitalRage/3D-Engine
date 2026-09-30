import { Modeler } from './modeler.js';

export function createCubeModel() {
    const m = new Modeler();
    m.addVertex(-0.5, -0.5,  0.5);
    m.addVertex( 0.5, -0.5,  0.5);
    m.addVertex( 0.5,  0.5,  0.5);
    m.addVertex(-0.5,  0.5,  0.5);
    m.addVertex(-0.5, -0.5, -0.5);
    m.addVertex( 0.5, -0.5, -0.5);
    m.addVertex( 0.5,  0.5, -0.5);
    m.addVertex(-0.5,  0.5, -0.5);

    m.addFace(0,1,2); m.addFace(0,2,3);
    m.addFace(4,5,6); m.addFace(4,6,7);
    m.addFace(0,4,7); m.addFace(0,7,3);
    m.addFace(1,5,6); m.addFace(1,6,2);
    m.addFace(3,2,6); m.addFace(3,6,7);
    m.addFace(0,1,5); m.addFace(0,5,4);

    return m;
}
