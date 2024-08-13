import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BracketComponent } from './bracket.component';

describe('BracketComponent', () => {
  let component: BracketComponent;
  let fixture: ComponentFixture<BracketComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [BracketComponent]
    });
    fixture = TestBed.createComponent(BracketComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
