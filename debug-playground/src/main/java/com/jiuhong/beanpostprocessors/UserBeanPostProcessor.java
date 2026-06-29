package com.jiuhong.beanpostprocessors;

import com.jiuhong.service.UserService;
import org.springframework.beans.factory.config.BeanPostProcessor;

public class UserBeanPostProcessor implements BeanPostProcessor {

	@Override
	public Object postProcessAfterInitialization(Object bean, String beanName) {
		if ("userService".equals(beanName)) {
			System.out.println("【After】" + beanName + " 被替换成了代理对象！");
			// 返回一个包装对象，而不是原对象
			return new UserServiceProxy((UserService) bean);
		}
		return bean;
	}

}

// 一个简单的代理类
class UserServiceProxy extends UserService {

	private UserService target;

	public UserServiceProxy(UserService target) {
		this.target = target;
	}

	@Override
	public void hello() {
		System.out.println("===== 代理前置增强 =====");
		target.hello();
		System.out.println("===== 代理后置增强 =====");
	}

}
