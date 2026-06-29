package com.jiuhong;

import com.jiuhong.beanpostprocessors.UserBeanPostProcessor;
import com.jiuhong.service.UserService;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.beans.factory.support.GenericBeanDefinition;

public class Step3_BPP_Proxy_Demo {

	public static void main(String[] args) {
		DefaultListableBeanFactory beanFactory = new DefaultListableBeanFactory();
		beanFactory.addBeanPostProcessor(new UserBeanPostProcessor());

		GenericBeanDefinition definition = new GenericBeanDefinition();
		definition.setBeanClass(UserService.class);
		beanFactory.registerBeanDefinition("userService", definition);

		UserService service = beanFactory.getBean("userService", UserService.class);
		service.hello();
	}

}
